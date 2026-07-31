import { useMemo, useState } from "react";

export type TriviaOption = { id: string; text: string; correct?: boolean };

export type TriviaQuestion = {
  id: string;
  prompt: string;
  options: TriviaOption[];
};

export type SponsorTier = "diamante" | "oro" | "plata" | "bronce";

export type TriviaCampaign = {
  id: string;
  sponsor: string;
  tier: SponsorTier;
  title: string;
  prize: string;
  logo: string;
  blurb: string;
  questions: TriviaQuestion[];
};

const genericDemo = (
  sponsor: string,
  q1Correct: string,
  q1Wrong: [string, string],
  q2Correct: string,
  q2Wrong: [string, string]
): TriviaQuestion[] => [
  {
    id: "q1",
    prompt: `1. En el congreso CMU, ¿qué aporta un patrocinio como el de ${sponsor}?`,
    options: [
      { id: "a", text: q1Correct, correct: true },
      { id: "b", text: q1Wrong[0] },
      { id: "c", text: q1Wrong[1] },
    ],
  },
  {
    id: "q2",
    prompt: `2. ¿Cuál es una buena práctica al hablar con el stand de ${sponsor}?`,
    options: [
      { id: "a", text: q2Correct, correct: true },
      { id: "b", text: q2Wrong[0] },
      { id: "c", text: q2Wrong[1] },
    ],
  },
];

export const TRIVIA_CAMPAIGNS: TriviaCampaign[] = [
  {
    id: "adium-diamante",
    sponsor: "Adium",
    tier: "diamante",
    title: "Trivia Adium",
    prize: "Kit / reconocimiento Adium (demo)",
    logo: "/assets/sponsors/logos/adium.png",
    blurb: "Patrocinador Diamante · urología",
    questions: genericDemo(
      "Adium",
      "Formación médica continua y presencia científica en el congreso",
      ["Solo merchandising sin contenido clínico", "Reemplazar al programa académico"],
      "Preguntar evidencia, indicaciones y materiales educativos del portafolio",
      ["Pedir solo souvenirs", "Ignorar contraindicaciones"]
    ),
  },
  {
    id: "astellas-diamante",
    sponsor: "Astellas",
    tier: "diamante",
    title: "Trivia Astellas",
    prize: "Kit / reconocimiento Astellas (demo)",
    logo: "/assets/sponsors/logos/astellas.png",
    blurb: "Patrocinador Diamante · oncología urológica",
    questions: genericDemo(
      "Astellas",
      "Simposios y sesiones de cáncer de próstata / guías clínicas",
      ["Solo coffee breaks", "Sustituir la Mesa Directiva"],
      "Revisar agenda nominativa (simposios) y preguntar por materiales NCCN/guías",
      ["No revisar el programa", "Confundir con otro laboratorio"]
    ),
  },
  {
    id: "liomont-oro",
    sponsor: "Liomont",
    tier: "oro",
    title: "Trivia Liomont",
    prize: "Kit clínico / reconocimiento del laboratorio (demo)",
    logo: "/assets/sponsors/logos/liomont.png",
    blurb: "Patrocinador Oro · HPB, DE e incontinencia",
    questions: [
      {
        id: "q1",
        prompt:
          "1. ¿Cuáles son las tres principales enfermedades urológicas que atiende Liomont?",
        options: [
          {
            id: "a",
            text: "1. Hiperplasia prostática\n2. Disfunción eréctil\n3. Incontinencia",
            correct: true,
          },
          {
            id: "b",
            text: "1. Litiasis\n2. Cáncer renal\n3. Estenosis uretral",
          },
          {
            id: "c",
            text: "1. ITU\n2. Varicocele\n3. Fimosis",
          },
        ],
      },
      {
        id: "q2",
        prompt:
          "2. ¿Cuál es la prevalencia por encuesta en Incontinencia Urinaria?",
        options: [
          {
            id: "a",
            text: "12% en mujeres jóvenes y 46% en mujeres de 50–60 años",
            correct: true,
          },
          {
            id: "b",
            text: "30% en mujeres jóvenes y 80% en mujeres de 50–60 años",
          },
          {
            id: "c",
            text: "3% en mujeres jóvenes y 8% en mujeres de 50–60 años",
          },
        ],
      },
    ],
  },
  {
    id: "senosiain-oro",
    sponsor: "Senosiain",
    tier: "oro",
    title: "Trivia Senosiain",
    prize: "Kit / reconocimiento Senosiain (demo)",
    logo: "/assets/sponsors/logos/senosiain.png",
    blurb: "Patrocinador Oro",
    questions: genericDemo(
      "Senosiain",
      "Apoyo a educación médica y portafolio relevante para urólogos",
      ["Solo branding en pasillos", "Cambiar horarios del CIC"],
      "Solicitar ficha técnica y evidencia de productos del área urológica",
      ["Inventar dosis", "Omitir interacciones"]
    ),
  },
  {
    id: "siegfried-oro",
    sponsor: "Siegfried Rhein",
    tier: "oro",
    title: "Trivia Siegfried Rhein",
    prize: "Kit / reconocimiento Siegfried (demo)",
    logo: "/assets/sponsors/logos/siegfried-rhein.png",
    blurb: "Patrocinador Oro",
    questions: genericDemo(
      "Siegfried Rhein",
      "Presencia Oro con materiales clínicos para el especialista",
      ["Patrocinio Bronce únicamente", "Sin relación con el congreso"],
      "Preguntar por portafolio y actividades del stand en el CIC",
      ["No visitar el stand", "Confundir el nivel de patrocinio"]
    ),
  },
  {
    id: "jj-plata",
    sponsor: "Johnson & Johnson",
    tier: "plata",
    title: "Trivia J&J Innovative Medicine",
    prize: "Reconocimiento J&J (demo)",
    logo: "/assets/sponsors/logos/johnson-johnson.png",
    blurb: "Patrocinador Plata",
    questions: genericDemo(
      "Johnson & Johnson Innovative Medicine",
      "Innovación terapéutica y presencia Plata en el congreso",
      ["Nivel Diamante exclusivo", "Sin stand ni materiales"],
      "Consultar evidencia y representantes científicos en el área",
      ["Tomar muestras sin registro", "Ignorar prospecto"]
    ),
  },
  {
    id: "boston-plata",
    sponsor: "Boston Scientific",
    tier: "plata",
    title: "Trivia Boston Scientific",
    prize: "Reconocimiento Boston Scientific (demo)",
    logo: "/assets/sponsors/logos/boston-scientific.png",
    blurb: "Patrocinador Plata · dispositivos / HBP",
    questions: genericDemo(
      "Boston Scientific",
      "Tecnología y talleres (p. ej. vapor HBP) ligados al programa",
      ["Solo fármacos orales", "Sin actividades nominativas"],
      "Revisar agenda de talleres/dispositivos y preguntar indicaciones",
      ["Operar sin entrenamiento", "Omitir contraindicaciones del dispositivo"]
    ),
  },
  {
    id: "az-plata",
    sponsor: "AstraZeneca",
    tier: "plata",
    title: "Trivia AstraZeneca",
    prize: "Reconocimiento AstraZeneca (demo)",
    logo: "/assets/sponsors/logos/astrazeneca.png",
    blurb: "Patrocinador Plata",
    questions: genericDemo(
      "AstraZeneca",
      "Portafolio oncológico / evidencia en urología oncológica",
      ["Solo material de oficina", "Sin relación clínica"],
      "Pedir datos de estudios y materiales educativos del stand",
      ["Compartir off-label sin sustento", "Ignorar seguridad"]
    ),
  },
];

const TIER_LABEL: Record<SponsorTier, string> = {
  diamante: "Diamante",
  oro: "Oro",
  plata: "Plata",
  bronce: "Bronce",
};

const STORAGE_KEY = "cmu-trivia-entries-v1";

type Entry = {
  campaignId: string;
  name: string;
  email: string;
  phone: string;
  score: number;
  total: number;
  at: number;
};

function loadEntries(): Entry[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

type Props = {
  open: boolean;
  onClose: () => void;
  onHome: () => void;
};

export function TriviaPanel({ open, onClose, onHome }: Props) {
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const campaign = TRIVIA_CAMPAIGNS.find((c) => c.id === campaignId) || null;
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const score = useMemo(() => {
    if (!campaign) return 0;
    let n = 0;
    for (const q of campaign.questions) {
      const pick = answers[q.id];
      const opt = q.options.find((o) => o.id === pick);
      if (opt?.correct) n += 1;
    }
    return n;
  }, [answers, campaign]);

  if (!open) return null;

  const resetQuiz = () => {
    setAnswers({});
    setSubmitted(false);
    setSaved(false);
    setName("");
    setEmail("");
    setPhone("");
    setError(null);
  };

  const backToHub = () => {
    resetQuiz();
    setCampaignId(null);
  };

  const pickCampaign = (id: string) => {
    resetQuiz();
    setCampaignId(id);
  };

  const allAnswered =
    !!campaign && campaign.questions.every((q) => answers[q.id]);

  const finishQuiz = () => {
    if (!allAnswered) {
      setError("Responde todas las preguntas para continuar.");
      return;
    }
    setError(null);
    setSubmitted(true);
  };

  const claimPrize = () => {
    if (!campaign) return;
    const em = email.trim();
    const ph = phone.trim();
    if (!name.trim() || (!em && !ph)) {
      setError("Necesitamos tu nombre y al menos correo o celular.");
      return;
    }
    if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      setError("Revisa el correo.");
      return;
    }
    const entry: Entry = {
      campaignId: campaign.id,
      name: name.trim(),
      email: em,
      phone: ph,
      score,
      total: campaign.questions.length,
      at: Date.now(),
    };
    const prev = loadEntries();
    localStorage.setItem(STORAGE_KEY, JSON.stringify([entry, ...prev]));
    setSaved(true);
    setError(null);
  };

  const byTier = (tier: SponsorTier) =>
    TRIVIA_CAMPAIGNS.filter((c) => c.tier === tier);

  return (
    <div className="overlay-panel trivia-panel" role="dialog" aria-label="Trivia">
      <div className="overlay-head">
        <div>
          <p className="overlay-kicker">Patrocinio · trivia</p>
          <h2>{campaign ? campaign.title : "Trivias de laboratorios"}</h2>
          <p className="overlay-sub">
            {campaign
              ? `Contesta bien y participa por: ${campaign.prize}`
              : "Elige un laboratorio patrocinador. Logos del congreso CMU."}
          </p>
        </div>
        <div className="overlay-actions">
          {campaign && (
            <button type="button" className="text-btn" onClick={backToHub}>
              Laboratorios
            </button>
          )}
          <button type="button" className="text-btn accent" onClick={onHome}>
            Inicio
          </button>
          <button type="button" className="text-btn" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>

      <div className="trivia-body">
        {!campaign ? (
          <div className="trivia-hub">
            {(["diamante", "oro", "plata"] as SponsorTier[]).map((tier) => {
              const list = byTier(tier);
              if (!list.length) return null;
              return (
                <section key={tier} className={`trivia-tier tier-${tier}`}>
                  <h3 className="trivia-tier-label">
                    Patrocinadores {TIER_LABEL[tier]}
                  </h3>
                  <div className="trivia-sponsor-grid">
                    {list.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="sponsor-card"
                        onClick={() => pickCampaign(c.id)}
                      >
                        <span className="sponsor-logo-wrap">
                          <img src={c.logo} alt="" />
                        </span>
                        <span className="sponsor-meta">
                          <span className="sponsor-name">{c.sponsor}</span>
                          <span className="sponsor-blurb">{c.blurb}</span>
                          <span className="sponsor-cta">Jugar trivia →</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
            <p className="trivia-legal">
              Demo de monetización: al acertar puedes registrar correo o celular
              para entrega de premio. En producción se guarda con consentimiento
              y backend del Colegio / laboratorio.
            </p>
          </div>
        ) : !submitted ? (
          <>
            <div className="trivia-campaign-banner">
              <img src={campaign.logo} alt={campaign.sponsor} />
              <div>
                <p className="overlay-kicker">
                  {TIER_LABEL[campaign.tier]} · {campaign.sponsor}
                </p>
                <p>{campaign.blurb}</p>
              </div>
            </div>
            {campaign.questions.map((q) => (
              <section key={q.id} className="trivia-q">
                <h3 className="trivia-prompt">{q.prompt}</h3>
                <div className="trivia-options">
                  {q.options.map((o) => {
                    const on = answers[q.id] === o.id;
                    return (
                      <button
                        key={o.id}
                        type="button"
                        className={`trivia-opt ${on ? "picked" : ""}`}
                        onClick={() =>
                          setAnswers((a) => ({ ...a, [q.id]: o.id }))
                        }
                      >
                        <span className="trivia-opt-id">
                          {o.id.toUpperCase()}
                        </span>
                        <span className="trivia-opt-text">{o.text}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
            {error && <p className="error-line">{error}</p>}
            <button
              type="button"
              className="solid-btn"
              onClick={finishQuiz}
              disabled={!allAnswered}
            >
              Ver resultado
            </button>
          </>
        ) : (
          <section className="trivia-result">
            <div className="trivia-campaign-banner compact">
              <img src={campaign.logo} alt="" />
            </div>
            <p className="trivia-score">
              Acertaste <strong>{score}</strong> de{" "}
              <strong>{campaign.questions.length}</strong>
            </p>
            {score === campaign.questions.length ? (
              <p>
                ¡Excelente! Eres elegible para el premio de {campaign.sponsor}.
                Déjanos datos comprobables para contactarte.
              </p>
            ) : (
              <p>
                Gracias por participar. Puedes reintentar o dejar datos para
                novedades de {campaign.sponsor}.
              </p>
            )}

            {!saved ? (
              <form
                className="trivia-claim"
                onSubmit={(e) => {
                  e.preventDefault();
                  claimPrize();
                }}
              >
                <label>
                  Nombre completo
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                    required
                  />
                </label>
                <label>
                  Correo
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    placeholder="opcional si dejas celular"
                  />
                </label>
                <label>
                  Celular
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    autoComplete="tel"
                    placeholder="opcional si dejas correo"
                  />
                </label>
                <p className="trivia-legal">
                  Al registrar aceptas que {campaign.sponsor} / CMU te contacten
                  sobre el premio (demo local).
                </p>
                {error && <p className="error-line">{error}</p>}
                <div className="trivia-claim-actions">
                  <button type="submit" className="solid-btn">
                    Registrar para premio
                  </button>
                  <button type="button" className="ghost-btn" onClick={resetQuiz}>
                    Reintentar
                  </button>
                </div>
              </form>
            ) : (
              <div className="trivia-done">
                <p>
                  Registro guardado. {campaign.sponsor} / CMU te contactarán si
                  resultas ganador.
                </p>
                <button type="button" className="solid-btn" onClick={backToHub}>
                  Otras trivias
                </button>
                <button type="button" className="ghost-btn" onClick={onHome}>
                  Volver al inicio
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

export const TRIVIA_LANDING = {
  label: "Trivias patrocinadas",
  blurb: "Adium, Astellas, Liomont y más · juega y gana",
};
