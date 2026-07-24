/**
 * APIs médicas públicas (educativas, no clínicas).
 * RxNorm + ClinicalTrials.gov + OpenFDA + PubMed (NCBI E-utilities).
 */

const DISCLAIMER =
  "Información educativa de fuentes públicas (NIH/FDA/NLM). No sustituye criterio clínico ni ficha local COFEPRIS.";

const UA = "CMU-2027-Assistant/1.0 (colegio; educational use)";

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      "User-Agent": UA,
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${url.slice(0, 80)} ${body.slice(0, 120)}`);
  }
  return (await res.json()) as T;
}

export type RxNormHit = {
  rxcui: string;
  name: string;
  synonym?: string;
  tty?: string;
};

export type ClinicalTrialHit = {
  nctId: string;
  title: string;
  status?: string;
  phase?: string;
  condition?: string;
  interventions?: string;
  url: string;
};

export type OpenFdaLabel = {
  brand?: string;
  generic?: string;
  indications?: string;
  warnings?: string;
  openfdaUrl?: string;
};

export type PubMedHit = {
  pmid: string;
  title: string;
  journal?: string;
  year?: string;
  url: string;
};

export type MedicalBundle = {
  query: string;
  rxnorm?: RxNormHit[];
  trials?: ClinicalTrialHit[];
  drugLabel?: OpenFdaLabel | null;
  pubmed?: PubMedHit[];
  disclaimer: string;
};

/** Extrae posible nombre de fármaco / tema clínico del prompt. */
export function extractMedicalQuery(prompt: string): {
  drug?: string;
  topic?: string;
  wantsDrug: boolean;
  wantsTrials: boolean;
  wantsEvidence: boolean;
} {
  const q = prompt.toLowerCase();
  const wantsDrug =
    /f[aá]rmaco|medicamento|droga|principio activo|gen[eé]rico|marca|dosis|indicaci[oó]n|prospecto|rxnorm|openfda|astellas|enzalutamida|abiraterona|sildenafil|tadalafil|finasterida|dutasterida|tamsulosina|mirabegr[oó]n|bcg|pembrolizumab|nivolumab|olaparib/.test(
      q
    );
  const wantsTrials =
    /ensayo|trial|clinicaltrial|estudio cl[ií]nico|reclutando|fase [123]|nct\d*/i.test(
      q
    ) || /qu[eé] trials|hay trials|estudios en curso/.test(q);
  const wantsEvidence =
    /evidencia|pubmed|paper|art[ií]culo|meta-?an[aá]lisis|gu[ií]a|nccn|eau|aue|literatura/.test(
      q
    );

  // Drug-like token after keywords (avoid bare "de/sobre")
  let drug: string | undefined;
  const drugMatch = prompt.match(
    /(?:f[aá]rmaco|medicamento|droga|principio activo|prospecto(?:\s+de)?)\s+([A-Za-zÁÉÍÓÚáéíóúñÑ][A-Za-zÁÉÍÓÚáéíóúñÑ0-9\-]{2,40})/i
  );
  if (drugMatch) drug = drugMatch[1];

  // Known urology drugs / brands as free text
  const known =
    prompt.match(
      /\b(enzalutamida|abiraterona|apalutamida|darolutamida|sildenafil|tadalafil|finasterida|dutasterida|tamsulosina|silodosina|mirabegron|mirabegrón|solifenacina|bcg|pembrolizumab|nivolumab|olaparib|docetaxel|cabazitaxel|leuprolide|degarelix|xtandi|zoladex|lupron|cialis|viagra|flomax|proscar|jalyn)\b/i
    );
  if (known) drug = known[1];

  // Clinical topic for trials/pubmed
  let topic: string | undefined;
  const topicPatterns: Array<[RegExp, string]> = [
    [/c[aá]ncer (de )?pr[oó]stata|pr[oó]stata avanzada|mcrpc|nmcrpc/i, "prostate cancer"],
    [/c[aá]ncer (de )?vejiga|vesical|nmibc|mibc/i, "bladder cancer"],
    [/c[aá]ncer renal|carcinoma renal|rcc/i, "renal cell carcinoma"],
    [/hbp|hiperplasia.*pr[oó]stata|enucleaci[oó]n|holep|thulep/i, "benign prostatic hyperplasia"],
    [/litiasis|c[aá]lculo|piedra|urolitiasis|urs|pcnl/i, "urolithiasis"],
    [/incontinencia|vejiga hiperactiva|oab/i, "overactive bladder"],
    [/disfunci[oó]n er[eé]ctil|pr[oó]tesis peneana/i, "erectile dysfunction"],
    [/psma|pet-?psma/i, "PSMA PET prostate cancer"],
    [/androlog[ií]a|medicina sexual/i, "andrology"],
  ];
  for (const [re, eng] of topicPatterns) {
    if (re.test(prompt)) {
      topic = eng;
      break;
    }
  }

  // If asking medical without explicit topic, try last meaningful phrase
  if (!topic && (wantsTrials || wantsEvidence)) {
    topic = prompt
      .replace(/[¿?¡!]/g, "")
      .trim()
      .slice(0, 80);
  }

  return {
    drug,
    topic,
    wantsDrug: wantsDrug || Boolean(drug),
    wantsTrials: wantsTrials || Boolean(topic && /trial|ensayo|estudio/i.test(q)),
    wantsEvidence: wantsEvidence || Boolean(topic && /evidencia|pubmed|paper/i.test(q)),
  };
}

export function detectMedicalIntent(prompt: string): boolean {
  const m = extractMedicalQuery(prompt);
  return (
    m.wantsDrug ||
    m.wantsTrials ||
    m.wantsEvidence ||
    /urolog[ií]a|oncourolog|endourolog|oncolog[ií]a urol/i.test(prompt)
  );
}

export async function searchRxNorm(term: string, limit = 5): Promise<RxNormHit[]> {
  const url = new URL("https://rxnav.nlm.nih.gov/REST/drugs.json");
  url.searchParams.set("name", term);
  const data = await getJson<{
    drugGroup?: {
      conceptGroup?: Array<{
        tty?: string;
        conceptProperties?: Array<{
          rxcui: string;
          name: string;
          synonym?: string;
          tty?: string;
        }>;
      }>;
    };
  }>(url.toString());

  const hits: RxNormHit[] = [];
  for (const g of data.drugGroup?.conceptGroup || []) {
    for (const c of g.conceptProperties || []) {
      hits.push({
        rxcui: c.rxcui,
        name: c.name,
        synonym: c.synonym,
        tty: c.tty || g.tty,
      });
      if (hits.length >= limit) return hits;
    }
  }

  // Fallback: approximate spell
  if (!hits.length) {
    const approx = new URL(
      "https://rxnav.nlm.nih.gov/REST/approximateTerm.json"
    );
    approx.searchParams.set("term", term);
    approx.searchParams.set("maxEntries", String(limit));
    const a = await getJson<{
      approximateGroup?: {
        candidate?: Array<{ rxcui: string; name?: string; rank?: string }>;
      };
    }>(approx.toString());
    for (const c of a.approximateGroup?.candidate || []) {
      if (!c.rxcui) continue;
      hits.push({ rxcui: c.rxcui, name: c.name || term });
      if (hits.length >= limit) break;
    }
  }
  return hits;
}

export async function searchClinicalTrials(
  query: string,
  limit = 5
): Promise<ClinicalTrialHit[]> {
  const url = new URL("https://clinicaltrials.gov/api/v2/studies");
  url.searchParams.set("query.term", query);
  url.searchParams.set("pageSize", String(limit));
  url.searchParams.set("format", "json");
  url.searchParams.set(
    "fields",
    "NCTId,BriefTitle,OverallStatus,Phase,Condition,InterventionName"
  );

  const data = await getJson<{
    studies?: Array<{
      protocolSection?: {
        identificationModule?: { nctId?: string; briefTitle?: string };
        statusModule?: { overallStatus?: string };
        designModule?: { phases?: string[] };
        conditionsModule?: { conditions?: string[] };
        armsInterventionsModule?: {
          interventions?: Array<{ name?: string; type?: string }>;
        };
      };
    }>;
  }>(url.toString());

  return (data.studies || [])
    .map((s) => {
      const id = s.protocolSection?.identificationModule;
      const status = s.protocolSection?.statusModule;
      const design = s.protocolSection?.designModule;
      const cond = s.protocolSection?.conditionsModule;
      const arms = s.protocolSection?.armsInterventionsModule;
      const nctId = id?.nctId || "";
      return {
        nctId,
        title: id?.briefTitle || "",
        status: status?.overallStatus,
        phase: design?.phases?.join(", "),
        condition: cond?.conditions?.slice(0, 3).join("; "),
        interventions: arms?.interventions
          ?.slice(0, 4)
          .map((i) => i.name)
          .filter(Boolean)
          .join("; "),
        url: nctId
          ? `https://clinicaltrials.gov/study/${nctId}`
          : "https://clinicaltrials.gov/",
      };
    })
    .filter((t) => t.nctId && t.title);
}

export async function searchOpenFdaLabel(
  drugName: string
): Promise<OpenFdaLabel | null> {
  const q = encodeURIComponent(
    `openfda.brand_name:"${drugName}" OR openfda.generic_name:"${drugName}"`
  );
  const url = `https://api.fda.gov/drug/label.json?search=${q}&limit=1`;
  try {
    const data = await getJson<{
      results?: Array<{
        openfda?: { brand_name?: string[]; generic_name?: string[] };
        indications_and_usage?: string[];
        warnings?: string[];
        warnings_and_cautions?: string[];
      }>;
    }>(url);
    const r = data.results?.[0];
    if (!r) return null;
    const clip = (s?: string, n = 400) =>
      s ? (s.length > n ? `${s.slice(0, n)}…` : s) : undefined;
    return {
      brand: r.openfda?.brand_name?.[0],
      generic: r.openfda?.generic_name?.[0],
      indications: clip(r.indications_and_usage?.[0]),
      warnings: clip(
        r.warnings_and_cautions?.[0] || r.warnings?.[0],
        350
      ),
      openfdaUrl: "https://open.fda.gov/apis/drug/label/",
    };
  } catch {
    // OpenFDA returns 404 when no results
    return null;
  }
}

export async function searchPubMed(
  query: string,
  limit = 4
): Promise<PubMedHit[]> {
  const esearch = new URL(
    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
  );
  esearch.searchParams.set("db", "pubmed");
  esearch.searchParams.set("retmode", "json");
  esearch.searchParams.set("retmax", String(limit));
  esearch.searchParams.set("sort", "relevance");
  esearch.searchParams.set("term", `${query} AND urology[sb]`);

  const search = await getJson<{
    esearchresult?: { idlist?: string[] };
  }>(esearch.toString());
  let ids = search.esearchresult?.idlist || [];

  // Fallback without urology filter if empty
  if (!ids.length) {
    esearch.searchParams.set("term", query);
    const s2 = await getJson<{ esearchresult?: { idlist?: string[] } }>(
      esearch.toString()
    );
    ids = s2.esearchresult?.idlist || [];
  }
  if (!ids.length) return [];

  const esummary = new URL(
    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi"
  );
  esummary.searchParams.set("db", "pubmed");
  esummary.searchParams.set("retmode", "json");
  esummary.searchParams.set("id", ids.join(","));

  const sum = await getJson<{
    result?: Record<
      string,
      {
        title?: string;
        source?: string;
        pubdate?: string;
        uid?: string;
      }
    >;
  }>(esummary.toString());

  return ids
    .map((id) => {
      const r = sum.result?.[id];
      if (!r?.title) return null;
      const year = r.pubdate?.match(/\d{4}/)?.[0];
      return {
        pmid: id,
        title: r.title,
        journal: r.source,
        year,
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
      } as PubMedHit;
    })
    .filter(Boolean) as PubMedHit[];
}

/** Orquesta búsquedas médicas según el prompt. */
export async function buildMedicalContext(
  prompt: string
): Promise<MedicalBundle | null> {
  const intent = extractMedicalQuery(prompt);
  if (
    !intent.wantsDrug &&
    !intent.wantsTrials &&
    !intent.wantsEvidence &&
    !intent.drug &&
    !intent.topic
  ) {
    // Soft trigger: explicit medical keywords without clear entity
    if (!detectMedicalIntent(prompt)) return null;
  }

  const query =
    intent.drug ||
    intent.topic ||
    prompt.replace(/[¿?¡!]/g, "").trim().slice(0, 100);

  const bundle: MedicalBundle = {
    query,
    disclaimer: DISCLAIMER,
  };

  const jobs: Array<Promise<void>> = [];

  if (intent.wantsDrug || intent.drug) {
    const drug = intent.drug || query;
    jobs.push(
      (async () => {
        try {
          bundle.rxnorm = await searchRxNorm(drug);
        } catch (e) {
          bundle.rxnorm = [];
          console.warn("[rxnorm]", e);
        }
        // OpenFDA suele responder mejor con nombre EN / genérico de RxNorm
        try {
          let label = await searchOpenFdaLabel(drug);
          if (!label && bundle.rxnorm?.[0]?.name) {
            const en = bundle.rxnorm[0].name.split(/\s+/)[0];
            label = await searchOpenFdaLabel(en);
          }
          if (!label) {
            // fallback EN known spellings
            const enMap: Record<string, string> = {
              enzalutamida: "enzalutamide",
              abiraterona: "abiraterone",
              tamsulosina: "tamsulosin",
              finasterida: "finasteride",
              dutasterida: "dutasteride",
              sildenafil: "sildenafil",
              tadalafil: "tadalafil",
              mirabegrón: "mirabegron",
              mirabegron: "mirabegron",
            };
            const alt = enMap[drug.toLowerCase()];
            if (alt) label = await searchOpenFdaLabel(alt);
          }
          bundle.drugLabel = label;
        } catch (e) {
          bundle.drugLabel = null;
          console.warn("[openfda]", e);
        }
      })()
    );
  }

  // Trials: if asked, or drug/topic for proactive urology congress context
  if (intent.wantsTrials || intent.topic || (intent.drug && intent.wantsEvidence)) {
    const trialQ = intent.topic || intent.drug || query;
    jobs.push(
      (async () => {
        try {
          bundle.trials = await searchClinicalTrials(trialQ);
        } catch (e) {
          bundle.trials = [];
          console.warn("[trials]", e);
        }
      })()
    );
  }

  if (intent.wantsEvidence || (intent.topic && intent.wantsTrials)) {
    const pq = intent.topic || intent.drug || query;
    jobs.push(
      (async () => {
        try {
          bundle.pubmed = await searchPubMed(pq);
        } catch (e) {
          bundle.pubmed = [];
          console.warn("[pubmed]", e);
        }
      })()
    );
  }

  // If only soft medical intent with a topic-like query, fetch trials + pubmed lightly
  if (
    !jobs.length &&
    detectMedicalIntent(prompt) &&
    (intent.topic || intent.drug)
  ) {
    const q = intent.topic || intent.drug || query;
    jobs.push(
      (async () => {
        try {
          bundle.trials = await searchClinicalTrials(q, 3);
        } catch {
          bundle.trials = [];
        }
      })()
    );
    jobs.push(
      (async () => {
        try {
          bundle.pubmed = await searchPubMed(q, 3);
        } catch {
          bundle.pubmed = [];
        }
      })()
    );
  }

  await Promise.all(jobs);

  const hasData =
    (bundle.rxnorm && bundle.rxnorm.length > 0) ||
    (bundle.trials && bundle.trials.length > 0) ||
    Boolean(bundle.drugLabel) ||
    (bundle.pubmed && bundle.pubmed.length > 0);

  return hasData || intent.wantsDrug || intent.wantsTrials || intent.wantsEvidence
    ? bundle
    : null;
}

export function medicalBundleToMarkdown(b: MedicalBundle): string {
  const parts: string[] = [
    `## Datos médicos en vivo (APIs públicas)`,
    `Consulta: ${b.query}`,
    `> ${b.disclaimer}`,
  ];

  if (b.rxnorm?.length) {
    parts.push(
      `### RxNorm (nombres normalizados)\n\`\`\`json\n${JSON.stringify(b.rxnorm, null, 2)}\n\`\`\``
    );
  }
  if (b.drugLabel) {
    parts.push(
      `### OpenFDA label (resumen)\n\`\`\`json\n${JSON.stringify(b.drugLabel, null, 2)}\n\`\`\``
    );
  }
  if (b.trials?.length) {
    parts.push(
      `### ClinicalTrials.gov\n\`\`\`json\n${JSON.stringify(b.trials, null, 2)}\n\`\`\``
    );
  }
  if (b.pubmed?.length) {
    parts.push(
      `### PubMed\n\`\`\`json\n${JSON.stringify(b.pubmed, null, 2)}\n\`\`\``
    );
  }

  parts.push(`### Instrucción
Resume en español con tablas cortas y enlaces. Incluye el disclaimer una vez.
No inventes dosis ni indiques tratamiento personalizado.`);

  return parts.join("\n\n");
}
