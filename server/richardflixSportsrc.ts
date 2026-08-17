/**
 * RichardFlix Sports API — proxy SportSRC con caché en memoria.
 * Vive en la misma plataforma que el Asistente CMU 2027 (Render),
 * pero es un proceso/rutas aparte (/rf/*).
 */
import { createHash } from "node:crypto";
import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";

const SPORTSRC_HOST = "https://api.sportsrc.org";
const DEFAULT_SPORTSRC_KEY = "5824e01ab5b0ecdc91310ecabbd16f32";

function sportSrcKey(): string {
  return process.env.SPORTSRC_API_KEY?.trim() || DEFAULT_SPORTSRC_KEY;
}

type CacheEntry = {
  body: unknown;
  fetchedAt: number;
  expiresAt: number;
};

const memoryCache = new Map<string, CacheEntry>();
const MAX_CACHE_ENTRIES = 400;

function cacheKey(parts: string): string {
  return createHash("sha256").update(parts).digest("hex").slice(0, 32);
}

function pruneCache(): void {
  if (memoryCache.size <= MAX_CACHE_ENTRIES) return;
  const now = Date.now();
  for (const [k, v] of memoryCache) {
    if (v.expiresAt < now) memoryCache.delete(k);
  }
  if (memoryCache.size <= MAX_CACHE_ENTRIES) return;
  const oldest = [...memoryCache.entries()]
    .sort((a, b) => a[1].fetchedAt - b[1].fetchedAt)
    .slice(0, Math.floor(MAX_CACHE_ENTRIES / 4));
  for (const [k] of oldest) memoryCache.delete(k);
}

function ttlForQuery(query: Record<string, string>): number {
  const type = String(query.type ?? "").toLowerCase();
  const data = String(query.data ?? "").toLowerCase();
  const status = String(query.status ?? "").toLowerCase();
  if (type === "detail" || data === "detail") return 20 * 60 * 1000;
  if (status === "inprogress") return 2 * 60 * 1000;
  if (type === "matches" || data === "matches") return 12 * 60 * 1000;
  return 10 * 60 * 1000;
}

function getCached(key: string, { allowStale }: { allowStale: boolean }): CacheEntry | null {
  const hit = memoryCache.get(key);
  if (!hit) return null;
  if (!allowStale && hit.expiresAt < Date.now()) return null;
  return hit;
}

function setCached(key: string, body: unknown, ttlMs: number): void {
  const now = Date.now();
  memoryCache.set(key, { body, fetchedAt: now, expiresAt: now + ttlMs });
  pruneCache();
}

async function fetchSportSrc(
  apiPath: string,
  query: Record<string, string>,
): Promise<{ status: number; body: unknown; cache: "HIT" | "MISS" | "STALE" }> {
  const qsObj = { ...query };
  // No cachear la api_key dentro del hash de query pública
  delete qsObj.api_key;
  delete qsObj.key;

  const qs = new URLSearchParams(qsObj).toString();
  const id = cacheKey(`${apiPath}?${qs}`);
  const ttl = ttlForQuery(qsObj);

  const fresh = getCached(id, { allowStale: false });
  if (fresh) return { status: 200, body: fresh.body, cache: "HIT" };

  const url = `${SPORTSRC_HOST}${apiPath}${qs ? `?${qs}` : ""}`;
  try {
    const upstream = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-API-KEY": sportSrcKey(),
        "User-Agent": "RichardFlixSports/1.0 (+cmu-2027-assistant)",
      },
    });
    const text = await upstream.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      /* keep text */
    }

    if (upstream.ok && body && typeof body === "object" && (body as { success?: boolean }).success === true) {
      setCached(id, body, ttl);
      return { status: upstream.status, body, cache: "MISS" };
    }

    // 404 de detail/id incorrecto es estable (WeStream vs V2); evita repetir el round-trip.
    if (upstream.status === 404) {
      setCached(id, body ?? { success: false }, Math.min(ttl, 5 * 60 * 1000));
      return { status: 404, body, cache: "MISS" };
    }

    if ([403, 429].includes(upstream.status) || upstream.status >= 500) {
      const stale = getCached(id, { allowStale: true });
      if (stale) return { status: 200, body: stale.body, cache: "STALE" };
    }

    return { status: upstream.status, body, cache: "MISS" };
  } catch (err) {
    const stale = getCached(id, { allowStale: true });
    if (stale) return { status: 200, body: stale.body, cache: "STALE" };
    throw err;
  }
}

function queryFromReq(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.query)) {
    if (typeof v === "string") out[k] = v;
    else if (Array.isArray(v) && typeof v[0] === "string") out[k] = v[0];
  }
  return out;
}

// ——— Normalización / filtros (misma lógica que el cliente RichardFlix) ———

export type SportTab = "en-vivo" | "nba" | "wnba" | "liga-mx" | "leagues-cup" | "nfl";

type SportMatch = {
  id: string;
  title: string;
  category: string;
  date: number;
  poster?: string;
  popular?: boolean;
  status?: string;
  statusDetail?: string;
  scoreDisplay?: string;
  leagueName?: string;
  teams?: {
    home?: { name: string; badge?: string; code?: string; color?: string };
    away?: { name: string; badge?: string; code?: string; color?: string };
  };
  api: "v1" | "v2";
  featured?: boolean;
};

const NFL_TOKENS = [
  "patriots", "bills", "dolphins", "jets", "ravens", "bengals", "browns", "steelers",
  "texans", "colts", "jaguars", "titans", "broncos", "chiefs", "raiders", "chargers",
  "cowboys", "giants", "eagles", "commanders", "bears", "lions", "packers", "vikings",
  "falcons", "panthers", "saints", "buccaneers", "cardinals", "rams", "49ers", "49-ers",
  "seahawks",
];

const CFL_OR_EURO = [
  "calgary", "winnipeg", "ottawa", "edmonton", "saskatchewan", "hamilton", "argonauts",
  "stampeders", "blue-bombers", "roughriders", "tiger-cats", "red-blacks", "bc-lions",
  "berlin", "vienna", "london-warriors", "rhein", "paris-lights", "alpine-rams",
  "wroclaw", "firenze",
];

const LIGA_MX_CLUBS = [
  "america", "américa", "atlas", "atlante", "chivas", "guadalajara", "cruz-azul",
  "cruz azul", "juarez", "juárez", "leon", "león", "mazatlan", "mazatlán", "monterrey",
  "necaxa", "pachuca", "puebla", "pumas", "queretaro", "querétaro", "santos", "tijuana",
  "tigres", "toluca", "san-luis", "san luis",
];

const MLS_CLUBS = [
  "atlanta", "austin", "charlotte", "chicago", "cincinnati", "colorado", "columbus",
  "dallas", "dc-united", "dc united", "houston", "inter-miami", "inter miami",
  "la-galaxy", "la galaxy", "lafc", "minnesota", "montreal", "nashville", "new-england",
  "new england", "nycfc", "new-york-city", "new york city", "new-york-red", "red bulls",
  "orlando", "philadelphia", "portland", "real-salt-lake", "salt lake", "san-diego",
  "san diego", "san-jose", "san jose", "seattle", "sporting-kansas", "sporting kansas",
  "st-louis", "st. louis", "toronto", "vancouver",
];

function blobHasAny(blob: string, tokens: string[]): boolean {
  return tokens.some((t) => blob.includes(t));
}

function isWnbaMatch(m: { id?: string; title?: string; category?: string }): boolean {
  const id = (m.id || "").toLowerCase();
  const title = (m.title || "").toLowerCase();
  if (id.includes("nflstreams") || id.includes("schedule")) return false;
  if (!id.includes("basketball") && m.category !== "basketball") return false;
  return (
    /\bw\b/.test(title.replace(/\./g, "")) ||
    id.includes("-w-") ||
    /fever|liberty|dream|storm|sky|aces|sparks|wings|sun|lynx|mystics|mercury|tempo|valkyries/.test(
      `${id} ${title}`,
    )
  );
}

const NBA_TOKENS = [
  "lakers",
  "celtics",
  "warriors",
  "knicks",
  "heat",
  "nuggets",
  "thunder",
  "spurs",
  "suns",
  "clippers",
  "bucks",
  "76ers",
  "sixers",
  "mavericks",
  "grizzlies",
  "pelicans",
  "hawks",
  "hornets",
  "pistons",
  "pacers",
  "raptors",
  "wizards",
  "magic",
  "cavaliers",
  "cavs",
  "rockets",
  "timberwolves",
  "trail-blazers",
  "trail blazers",
  "blazers",
  "jazz",
  "kings",
  "bulls",
  "nets",
];

function isNbaMatch(m: { id?: string; title?: string; category?: string }): boolean {
  const id = (m.id || "").toLowerCase();
  const title = (m.title || "").toLowerCase();
  if (id.includes("nflstreams") || id.includes("schedule")) return false;
  if (isWnbaMatch(m)) return false;
  const cat = (m.category || "").toLowerCase();
  if (cat && cat !== "basketball" && cat !== "nba" && !id.includes("basketball")) {
    return false;
  }
  const blob = `${id} ${title}`;
  return NBA_TOKENS.some((t) => blob.includes(t));
}

function isIndianaFever(m: { id?: string; title?: string }): boolean {
  const s = `${m.id || ""} ${m.title || ""}`.toLowerCase();
  return s.includes("indiana-fever") || s.includes("indiana fever");
}

const MATCHUP_STOP = new Set([
  "vs",
  "at",
  "w",
  "fc",
  "cf",
  "sc",
  "afc",
  "cfc",
  "club",
  "de",
  "la",
  "el",
  "the",
  "ii",
]);

/** Clave de cruce ignorando " W"/FC/CF, orden de equipos y vs/at. */
function matchupKey(
  title: string,
  teams?: SportMatch["teams"],
): string {
  const raw =
    teams?.home?.name && teams?.away?.name
      ? `${teams.home.name} ${teams.away.name}`
      : title;
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\bw\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w && !MATCHUP_STOP.has(w) && !/^\d+$/.test(w))
    .sort()
    .join(" ");
}

function isNflMatch(m: { id?: string; title?: string }): boolean {
  const id = (m.id || "").toLowerCase();
  const title = (m.title || "").toLowerCase();
  const blob = `${id} ${title}`;
  if (CFL_OR_EURO.some((t) => blob.includes(t))) return false;
  if (id.includes("bc-lions") || title.includes("bc lions")) return false;
  return NFL_TOKENS.some((t) => blob.includes(t));
}

function isLeaguesCupV1Match(m: { id?: string; title?: string }): boolean {
  const blob = `${m.id || ""} ${m.title || ""}`.toLowerCase();
  if (blob.includes("leagues-cup") || blob.includes("leagues cup")) return true;
  return blobHasAny(blob, LIGA_MX_CLUBS) && blobHasAny(blob, MLS_CLUBS);
}

function normalizeV1(m: Record<string, unknown>): SportMatch {
  return {
    id: String(m.id),
    title: String(m.title || m.id),
    category: String(m.category || "basketball"),
    date: Number(m.date) || 0,
    poster: typeof m.poster === "string" ? m.poster : undefined,
    popular: Boolean(m.popular),
    teams: m.teams as SportMatch["teams"],
    api: "v1",
    featured: isIndianaFever(m as { id?: string; title?: string }),
  };
}

function normalizeV2(m: Record<string, unknown>, leagueName: string): SportMatch {
  const score = m.score as { display?: string } | undefined;
  return {
    id: String(m.id),
    title: String(m.title || m.id),
    category: "football",
    date: Number(m.timestamp) || Number(m.date) || 0,
    status: typeof m.status === "string" ? m.status : undefined,
    statusDetail: typeof m.status_detail === "string" ? m.status_detail : undefined,
    scoreDisplay: score?.display,
    leagueName,
    teams: m.teams as SportMatch["teams"],
    api: "v2",
  };
}

function rankStatus(s?: string) {
  if (s === "inprogress") return 0;
  if (s === "scheduled" || !s) return 1;
  return 2;
}

function sortFootball(items: SportMatch[]): SportMatch[] {
  return [...items].sort((a, b) => {
    const r = rankStatus(a.status) - rankStatus(b.status);
    if (r !== 0) return r;
    return a.date - b.date;
  });
}

function isoDateUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function fetchV2FootballByLeague(
  leagueMatch: (name: string) => boolean,
  daysBack: number,
  daysForward: number,
): Promise<SportMatch[]> {
  const today = new Date();
  today.setUTCHours(12, 0, 0, 0);
  const statuses = ["inprogress", "scheduled", "finished"] as const;
  const out: SportMatch[] = [];
  const seen = new Set<string>();
  const dates: string[] = [];
  for (let i = -daysBack; i <= daysForward; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + i);
    dates.push(isoDateUTC(d));
  }

  const chunkSize = 4;
  for (let i = 0; i < dates.length; i += chunkSize) {
    const chunk = dates.slice(i, i + chunkSize);
    await Promise.all(
      chunk.flatMap((date) =>
        statuses.map(async (status) => {
          try {
            const { body } = await fetchSportSrc("/v2/", {
              type: "matches",
              sport: "football",
              status,
              date,
            });
            const data = body as {
              data?: Array<{ league?: { name?: string }; matches?: Record<string, unknown>[] }>;
            };
            for (const lg of data.data || []) {
              const name = (lg.league?.name || "").trim();
              if (!leagueMatch(name)) continue;
              for (const m of lg.matches || []) {
                const id = String(m.id || "");
                if (!id || seen.has(id)) continue;
                seen.add(id);
                out.push(normalizeV2(m, name));
              }
            }
          } catch {
            /* ignore */
          }
        }),
      ),
    );
  }
  return sortFootball(out);
}

async function basketballPool(): Promise<SportMatch[]> {
  const { body } = await fetchSportSrc("/", { data: "matches", category: "basketball" });
  const v1 = ((body as { data?: Record<string, unknown>[] }).data || []).map(normalizeV1);
  const seen = new Set(v1.map((m) => m.id));
  const extra: SportMatch[] = [];
  try {
    const ws = await listWeStreamCandidates("basketball");
    for (const m of ws) {
      const id = String(m.id || "");
      if (!id || seen.has(id) || isJunkLiveListing(m)) continue;
      extra.push({
        id,
        title: String(m.title || id),
        category: String(m.category || "basketball"),
        date: Number(m.date) || 0,
        popular: Boolean(m.popular),
        poster: typeof m.poster === "string" ? m.poster : undefined,
        teams: m.teams,
        api: "v1",
      });
      seen.add(id);
    }
  } catch {
    /* WeStream opcional */
  }
  return [...v1, ...extra];
}

/** Dedupe mismo cruce con ids gemelos; preferir el que tenga stream. */
async function dedupeBasketballMatches(items: SportMatch[]): Promise<SportMatch[]> {
  const groups = new Map<string, SportMatch[]>();
  for (const m of items) {
    const key = matchupKey(m.title, m.teams);
    const list = groups.get(key) || [];
    list.push(m);
    groups.set(key, list);
  }

  const deduped: SportMatch[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      deduped.push(group[0]!);
      continue;
    }
    let best = group[0]!;
    let bestScore = -1;
    for (const m of group) {
      let score = 0;
      if (m.featured) score += 5;
      if (/-w-.*-w-basketball-/i.test(m.id)) score -= 3;
      const ws = await findWeStreamMatch(m.id, "basketball");
      const refs = ws?.sources || [];
      if (refs.some((r) => /^(admin|delta)$/i.test(r.source))) score += 20;
      const src = await sportSrcSourcesForMatch(m.id, "basketball");
      if (src.length) score += 30 + src.length;
      const wsStreams = await resolveWeStreamSourceRefs(refs);
      if (wsStreams.length) score += 25 + wsStreams.length;
      if (score > bestScore) {
        bestScore = score;
        best = m;
      }
    }
    deduped.push(best);
  }

  return deduped.sort((a, b) => {
    if (a.featured !== b.featured) return a.featured ? -1 : 1;
    return a.date - b.date;
  });
}

async function buildWnba(): Promise<SportMatch[]> {
  const items = (await basketballPool()).filter(isWnbaMatch);
  return dedupeBasketballMatches(items);
}

async function buildNba(): Promise<SportMatch[]> {
  const items = (await basketballPool()).filter(isNbaMatch);
  return dedupeBasketballMatches(items);
}

async function buildNfl(): Promise<SportMatch[]> {
  const { body } = await fetchSportSrc("/", {
    data: "matches",
    category: "american-football",
  });
  const data = body as { data?: Record<string, unknown>[] };
  return (data.data || [])
    .filter(isNflMatch)
    .map((m) => ({ ...normalizeV1(m), category: "american-football" }))
    .sort((a, b) => a.date - b.date);
}

async function buildLigaMx(): Promise<SportMatch[]> {
  return fetchV2FootballByLeague((name) => {
    const lower = name.toLowerCase();
    if (!lower.includes("liga mx")) return false;
    if (lower.includes("women") || lower.includes("u21") || lower.includes("u-21")) return false;
    return true;
  }, 5, 14);
}

async function buildLeaguesCup(): Promise<SportMatch[]> {
  const [v2, v1res] = await Promise.all([
    fetchV2FootballByLeague(
      (name) => /leagues?\s*cup/i.test(name) || /copa\s*de\s*ligas/i.test(name),
      7,
      14,
    ),
    fetchSportSrc("/", { data: "matches", category: "football" }),
  ]);
  const seen = new Set(v2.map((m) => m.id));
  const v1data = v1res.body as { data?: Record<string, unknown>[] };
  const v1 = (v1data.data || [])
    .filter(isLeaguesCupV1Match)
    .map((m) => {
      const match = normalizeV1(m);
      return {
        ...match,
        category: "football",
        leagueName: "Leagues Cup",
        status: match.date && match.date > Date.now() ? "scheduled" : match.status,
      };
    })
    .filter((m) => !seen.has(m.id));
  return sortFootball([...v2, ...v1]);
}

const LIVE_CATEGORY_LABEL: Record<string, string> = {
  football: "Fútbol",
  basketball: "Basketball",
  "american-football": "NFL / Football",
  baseball: "Beisbol",
  hockey: "Hockey",
  tennis: "Tenis",
  mma: "MMA",
  boxing: "Box",
};

function isJunkLiveListing(m: { id?: string; title?: string }): boolean {
  const id = (m.id || "").toLowerCase();
  const title = (m.title || "").toLowerCase();
  if (id.includes("schedule") || id.includes("nflstreams")) return true;
  if (title.includes("streams schedule")) return true;
  return false;
}

// ——— WeStream / streamed (fallback cuando SportSRC no trae embeds) ———

type WeStreamSourceRef = { source: string; id: string };
type WeStreamMatchRaw = {
  id?: string;
  title?: string;
  category?: string;
  date?: number;
  popular?: boolean;
  poster?: string;
  teams?: SportMatch["teams"];
  sources?: WeStreamSourceRef[];
};

type StreamOption = {
  id?: string;
  streamNo?: number;
  language?: string;
  hd?: boolean;
  embedUrl: string;
  source?: string;
};

const WESTREAM_MATCHES_LIVE = "https://westream.su/matches/live";
const WESTREAM_STREAM_BASES = [
  "https://streamed.pk/api/stream",
  "https://westream.su/stream",
] as const;

async function fetchExternalJson<T>(url: string, ttlMs = 90_000): Promise<T | null> {
  const id = cacheKey(`ext:${url}`);
  const fresh = getCached(id, { allowStale: false });
  if (fresh) return fresh.body as T;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "RichardFlixSports/1.0",
      },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as T;
    setCached(id, body, ttlMs);
    return body;
  } catch {
    const stale = getCached(id, { allowStale: true });
    return stale ? (stale.body as T) : null;
  }
}

function scoreEmbed(s: StreamOption): number {
  const url = (s.embedUrl || "").toLowerCase();
  const lang = (s.language || "").toLowerCase();
  let n = 0;
  // streamapi es el que sí reproduce en RichardFlix (WNBA). embed.st/Clappr
  // suele tirar hls:networkError_manifestLoadError.
  if (url.includes("embed.streamapi.cc")) n += 80;
  if (url.includes("football77.org")) n += 35;
  if (url.includes("embed.st/embed/")) n += 8;
  if (url.includes("westream.su/embed")) n += 4;
  if (url.includes("mutstreams")) n -= 100;
  if (lang.includes("spanish") || lang.includes("español") || lang.startsWith("es")) n += 25;
  if (s.hd) n += 5;
  if ((s.source || "").toLowerCase() === "admin") n += 8;
  if ((s.source || "").toLowerCase() === "delta") n += 2;
  return n;
}

function mergeStreamOptions(...lists: StreamOption[][]): StreamOption[] {
  const seen = new Set<string>();
  const out: StreamOption[] = [];
  for (const list of lists) {
    for (const s of list) {
      const embed = (s.embedUrl || "").trim();
      if (!embed || seen.has(embed)) continue;
      if (/mutstreams\.pk/i.test(embed)) continue;
      seen.add(embed);
      out.push(s);
    }
  }
  return out.sort((a, b) => scoreEmbed(b) - scoreEmbed(a));
}

async function sportSrcV2SourcesForMatch(matchId: string): Promise<StreamOption[]> {
  if (!matchId || /^\d+$/.test(matchId)) return [];
  try {
    const res = await fetchSportSrc("/v2/", { type: "detail", id: matchId });
    return extractSourcesFromSportSrcBody(res.body);
  } catch {
    return [];
  }
}

async function sportSrcSourcesForMatch(
  matchId: string,
  category: string,
): Promise<StreamOption[]> {
  if (!matchId || /^\d+$/.test(matchId)) return [];
  const v2 = await sportSrcV2SourcesForMatch(matchId);
  if (v2.length) return v2;

  const cats = Array.from(
    new Set(
      [category, "football", "american-football", "basketball"].filter(Boolean),
    ),
  );
  for (const cat of cats) {
    try {
      const res = await fetchSportSrc("/", {
        data: "detail",
        category: cat,
        id: matchId,
      });
      const sources = extractSourcesFromSportSrcBody(res.body);
      if (sources.length) return sources;
    } catch {
      /* siguiente categoría */
    }
  }
  return [];
}

async function listSportSrcV2FootballRecent(): Promise<SportMatch[]> {
  const today = new Date();
  today.setUTCHours(12, 0, 0, 0);
  const dates: string[] = [];
  for (let i = -1; i <= 1; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + i);
    dates.push(isoDateUTC(d));
  }
  const out: SportMatch[] = [];
  const seen = new Set<string>();
  await Promise.all(
    dates.flatMap((date) =>
      (["inprogress", "scheduled", "finished"] as const).map(async (status) => {
        try {
          const { body } = await fetchSportSrc("/v2/", {
            type: "matches",
            sport: "football",
            status,
            date,
          });
          const data = body as {
            data?: Array<{ league?: { name?: string }; matches?: Record<string, unknown>[] }>;
          };
          for (const lg of data.data || []) {
            const name = (lg.league?.name || "").trim();
            for (const raw of lg.matches || []) {
              const id = String(raw.id || "");
              if (!id || seen.has(id)) continue;
              seen.add(id);
              out.push(normalizeV2(raw, name));
            }
          }
        } catch {
          /* ignore */
        }
      }),
    ),
  );
  return out;
}

async function sportSrcSourcesByMatchup(
  title: string | undefined,
  teams: SportMatch["teams"] | undefined,
  category?: string,
): Promise<StreamOption[]> {
  const key = matchupKey(title || "", teams);
  if (!key) return [];
  const cats =
    category === "american-football"
      ? ["american-football"]
      : category === "basketball"
        ? ["basketball"]
        : ["football", "american-football"];
  const out: StreamOption[] = [];
  for (const cat of cats) {
    try {
      const { body } = await fetchSportSrc("/", {
        data: "matches",
        category: cat,
      });
      const items = (body as { data?: Record<string, unknown>[] }).data || [];
      for (const raw of items) {
        const m = normalizeV1(raw);
        if (matchupKey(m.title, m.teams) !== key) continue;
        out.push(...(await sportSrcSourcesForMatch(m.id, cat)));
      }
    } catch {
      /* ignore */
    }
  }
  if (category !== "american-football" && category !== "basketball") {
    try {
      const v2 = await listSportSrcV2FootballRecent();
      for (const m of v2) {
        if (matchupKey(m.title, m.teams) !== key) continue;
        out.push(...(await sportSrcV2SourcesForMatch(m.id)));
      }
    } catch {
      /* ignore */
    }
  }
  return mergeStreamOptions(out);
}

async function resolveWeStreamSourceRefs(
  refs: WeStreamSourceRef[],
): Promise<StreamOption[]> {
  const out: StreamOption[] = [];
  const seen = new Set<string>();
  const extra: WeStreamSourceRef[] = [...refs];

  for (const ref of refs) {
    if (!ref?.id) continue;
    // El id de WeStream a veces ES el id SportSRC (ppv-packers-...)
    extra.push({ source: "admin", id: ref.id });
  }

  for (const ref of extra) {
    if (!ref?.source || !ref?.id) continue;
    const srcFromSport = await sportSrcSourcesForMatch(ref.id, "football");
    for (const s of srcFromSport) {
      const embed = (s.embedUrl || "").trim();
      if (!embed || seen.has(embed) || /mutstreams\.pk/i.test(embed)) continue;
      seen.add(embed);
      out.push(s);
    }

    for (const base of WESTREAM_STREAM_BASES) {
      const url = `${base}/${encodeURIComponent(ref.source)}/${encodeURIComponent(ref.id)}`;
      const streams = await fetchExternalJson<StreamOption[]>(url, 60_000);
      if (!Array.isArray(streams) || !streams.length) continue;
      for (const s of streams) {
        const embed = (s.embedUrl || "").trim();
        if (!embed || seen.has(embed)) continue;
        if (/mutstreams\.pk/i.test(embed)) continue;
        seen.add(embed);
        out.push({
          ...s,
          embedUrl: embed,
          source: s.source || ref.source,
        });
      }
      break;
    }
  }
  return mergeStreamOptions(out);
}

async function findWeStreamMatch(
  matchId: string,
  category?: string,
): Promise<WeStreamMatchRaw | null> {
  const live = (await fetchExternalJson<WeStreamMatchRaw[]>(WESTREAM_MATCHES_LIVE)) || [];
  const hitLive = live.find((m) => m.id === matchId);
  if (hitLive) return hitLive;

  const cat = (category || "football").toLowerCase();
  const listUrl =
    cat === "football" || cat === "soccer"
      ? "https://westream.su/matches/football"
      : `https://westream.su/matches/${encodeURIComponent(cat)}`;
  const list = (await fetchExternalJson<WeStreamMatchRaw[]>(listUrl, 120_000)) || [];
  return list.find((m) => m.id === matchId) || null;
}

async function listWeStreamCandidates(
  category?: string,
): Promise<WeStreamMatchRaw[]> {
  const cat = (category || "football").toLowerCase();
  const listUrl =
    cat === "football" || cat === "soccer"
      ? "https://westream.su/matches/football"
      : `https://westream.su/matches/${encodeURIComponent(cat)}`;
  const [live, list] = await Promise.all([
    fetchExternalJson<WeStreamMatchRaw[]>(WESTREAM_MATCHES_LIVE, 60_000),
    fetchExternalJson<WeStreamMatchRaw[]>(listUrl, 120_000),
  ]);
  const byId = new Map<string, WeStreamMatchRaw>();
  for (const m of [...(live || []), ...(list || [])]) {
    if (m?.id) byId.set(m.id, m);
  }
  return [...byId.values()];
}

/** Misma pelea, otro id (ej. Dream W …-495016 vs Dream …-2449325). */
async function findSiblingStreamSources(
  matchId: string,
  category: string | undefined,
  title?: string,
  teams?: SportMatch["teams"],
): Promise<StreamOption[]> {
  const key = matchupKey(title || matchId, teams);
  if (!key) return [];

  const candidates = await listWeStreamCandidates(category);
  const siblings = candidates.filter((m) => {
    if (!m.id || m.id === matchId) return false;
    return matchupKey(String(m.title || m.id), m.teams) === key;
  });

  const out: StreamOption[] = [];
  for (const sib of siblings) {
    const ws = await resolveWeStreamSourceRefs(sib.sources || []);
    const src = await sportSrcSourcesForMatch(sib.id!, category || "basketball");
    out.push(...mergeStreamOptions(src, ws));
  }
  return mergeStreamOptions(out);
}

async function enrichSourcesFromWeStream(
  matchId: string,
  category: string | undefined,
  existing: StreamOption[],
  meta?: { title?: string; teams?: SportMatch["teams"] },
): Promise<StreamOption[]> {
  const ws = await findWeStreamMatch(matchId, category);
  const fromSelf = ws?.sources?.length
    ? await resolveWeStreamSourceRefs(ws.sources)
    : [];
  const siblings = await findSiblingStreamSources(
    matchId,
    category,
    meta?.title || ws?.title,
    meta?.teams || ws?.teams,
  );
  const byMatchup = await sportSrcSourcesByMatchup(
    meta?.title || ws?.title,
    meta?.teams || ws?.teams,
    category,
  );
  const fromId = await sportSrcSourcesForMatch(matchId, category || "football");
  return mergeStreamOptions(existing, fromId, fromSelf, siblings, byMatchup);
}

/** En vivo real: WeStream live + solo si hay embeds API reales (SportSRC y/o stream API). */
async function buildEnVivo(): Promise<SportMatch[]> {
  const live = (await fetchExternalJson<WeStreamMatchRaw[]>(WESTREAM_MATCHES_LIVE, 60_000)) || [];
  const out: SportMatch[] = [];

  for (const raw of live) {
    const id = String(raw.id || "");
    if (!id || isJunkLiveListing(raw)) continue;
    const category = String(raw.category || "football");
    const [wsStreams, srcStreams, byMatchup] = await Promise.all([
      resolveWeStreamSourceRefs(raw.sources || []),
      sportSrcSourcesForMatch(id, category),
      sportSrcSourcesByMatchup(raw.title, raw.teams, category),
    ]);
    const streams = mergeStreamOptions(srcStreams, wsStreams, byMatchup);
    if (!streams.length) continue;

    const startedAt = Number(raw.date) || 0;
    const ageMs = startedAt ? Date.now() - startedAt : 0;
    const hasStable = streams.some((s) => {
      const url = (s.embedUrl || "").toLowerCase();
      return url.includes("embed.streamapi.cc") || url.includes("football77.org");
    });
    // Feeds WeStream "live" a veces quedan colgados (MLS de anoche con Clappr muerto).
    if (ageMs > 18 * 60 * 60 * 1000) continue;
    if (ageMs > 4.5 * 60 * 60 * 1000 && !hasStable) continue;

    const detailKey = cacheKey(`detail-enriched:v3:${category}:${id}`);
    setCached(
      detailKey,
      {
        success: true,
        data: {
          id,
          title: raw.title || id,
          category,
          date: Number(raw.date) || 0,
          popular: Boolean(raw.popular),
          poster: raw.poster,
          teams: raw.teams,
          sources: streams,
        },
      },
      90_000,
    );

    out.push({
      id,
      title: String(raw.title || id),
      category,
      date: Number(raw.date) || 0,
      popular: Boolean(raw.popular),
      poster: typeof raw.poster === "string" ? raw.poster : undefined,
      teams: raw.teams,
      api: "v1",
      status: "inprogress",
      leagueName: LIVE_CATEGORY_LABEL[category] || category,
    });
  }

  return out.sort((a, b) => a.date - b.date);
}

const TAB_BUILDERS: Record<SportTab, () => Promise<SportMatch[]>> = {
  "en-vivo": buildEnVivo,
  nba: buildNba,
  wnba: buildWnba,
  nfl: buildNfl,
  "liga-mx": buildLigaMx,
  "leagues-cup": buildLeaguesCup,
};

const TAB_TTL_MS: Record<SportTab, number> = {
  "en-vivo": 60 * 1000,
  nba: 10 * 60 * 1000,
  wnba: 10 * 60 * 1000,
  nfl: 10 * 60 * 1000,
  "liga-mx": 15 * 60 * 1000,
  "leagues-cup": 12 * 60 * 1000,
};

async function getTabMatches(tab: SportTab): Promise<{ matches: SportMatch[]; cache: string }> {
  const id = cacheKey(`tab:${tab}`);
  const ttl = TAB_TTL_MS[tab];
  const fresh = getCached(id, { allowStale: false });
  if (fresh) {
    return { matches: fresh.body as SportMatch[], cache: "HIT" };
  }
  try {
    const matches = await TAB_BUILDERS[tab]();
    setCached(id, matches, ttl);
    return { matches, cache: "MISS" };
  } catch (err) {
    const stale = getCached(id, { allowStale: true });
    if (stale) return { matches: stale.body as SportMatch[], cache: "STALE" };
    throw err;
  }
}

function extractSourcesFromSportSrcBody(body: unknown): StreamOption[] {
  if (!body || typeof body !== "object") return [];
  const data = (body as { data?: Record<string, unknown> }).data;
  if (!data || typeof data !== "object") return [];
  const sources = (data.sources as StreamOption[]) || [];
  return sources.filter((s) => Boolean(s?.embedUrl));
}

async function getDetail(opts: {
  api: "v1" | "v2";
  id: string;
  category?: string;
}): Promise<{ body: unknown; cache: string }> {
  const enrichedKey = cacheKey(`detail-enriched:v3:${opts.api}:${opts.category || ""}:${opts.id}`);
  const enrichedHit = getCached(enrichedKey, { allowStale: false });
  if (enrichedHit) {
    const cachedSources = extractSourcesFromSportSrcBody(enrichedHit.body);
    if (cachedSources.length) return { body: enrichedHit.body, cache: "HIT" };
  }

  if (opts.api === "v2") {
    const res = await fetchSportSrc("/v2/", { type: "detail", id: opts.id });
    const data = (res.body as { data?: Record<string, unknown> })?.data || {};
    const info = ((data as { match_info?: Record<string, unknown> }).match_info ||
      data) as Record<string, unknown>;
    const srcSources = extractSourcesFromSportSrcBody(res.body);
    const wsSources = await enrichSourcesFromWeStream(
      opts.id,
      opts.category || "football",
      [],
      {
        title:
          typeof info.title === "string" && info.title.trim()
            ? info.title
            : opts.id,
        teams: info.teams as SportMatch["teams"],
      },
    );
    const sources = mergeStreamOptions(srcSources, wsSources);
    if (!sources.length) return { body: res.body, cache: res.cache };

    const body = {
      success: true,
      data: {
        ...data,
        sources,
        match_info: (data as { match_info?: unknown }).match_info || data,
      },
    };
    setCached(enrichedKey, body, 90_000);
    return { body, cache: "MISS" };
  }

  const res = await fetchSportSrc("/", {
    data: "detail",
    category: opts.category || "basketball",
    id: opts.id,
  });

  const rawData =
    ((res.body as { data?: Record<string, unknown> })?.data as Record<string, unknown>) || {
      id: opts.id,
      category: opts.category || "football",
    };

  const srcSources = extractSourcesFromSportSrcBody(res.body);
  const wsSources = await enrichSourcesFromWeStream(opts.id, opts.category, [], {
    title:
      typeof rawData.title === "string" && rawData.title.trim()
        ? rawData.title
        : opts.id,
    teams: rawData.teams as SportMatch["teams"],
  });
  const sources = mergeStreamOptions(srcSources, wsSources);

  const body = {
    success: true,
    data: {
      ...rawData,
      sources,
    },
  };
  if (sources.length) setCached(enrichedKey, body, 90_000);
  return { body, cache: sources.length ? "MISS" : res.cache };
}

function setCors(res: Response): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Accept, Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

export function createRichardflixSportsRouter(): Router {
  const router = createRouter();

  router.use((req, res, next) => {
    setCors(res);
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  router.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "richardflix-sports",
      cacheEntries: memoryCache.size,
      hasSportSrcKey: Boolean(sportSrcKey()),
    });
  });

  /** Proxy crudo: /rf/sportsrc/?data=matches&category=basketball */
  router.use("/sportsrc", async (req, res) => {
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.status(405).json({ success: false, error: "method not allowed" });
      return;
    }
    try {
      const apiPath = req.path && req.path !== "/" ? req.path : "/";
      const query = queryFromReq(req);
      const result = await fetchSportSrc(apiPath, query);
      res.setHeader("X-SportSrc-Cache", result.cache);
      res.setHeader("Cache-Control", "public, max-age=60");
      if (req.method === "HEAD") {
        res.status(result.status).end();
        return;
      }
      res.status(result.status).json(result.body);
    } catch (e) {
      res.status(502).json({
        success: false,
        error: e instanceof Error ? e.message : "sportsrc proxy error",
      });
    }
  });

  /** Detalle (antes de :tab para no capturar "detail" como tab) */
  router.get("/sports/detail", async (req, res) => {
    const id = String(req.query.id || "");
    const api = req.query.api === "v2" ? "v2" : "v1";
    const category = typeof req.query.category === "string" ? req.query.category : undefined;
    if (!id) {
      res.status(400).json({ success: false, error: "id requerido" });
      return;
    }
    try {
      const { body, cache } = await getDetail({ api, id, category });
      res.setHeader("X-SportSrc-Cache", cache);
      res.setHeader("Cache-Control", "public, max-age=30");
      res.json(body);
    } catch (e) {
      res.status(502).json({
        success: false,
        error: e instanceof Error ? e.message : "detail error",
      });
    }
  });

  /** Agregados cacheados por liga — 1 request cliente → N upstream con caché */
  router.get("/sports/:tab", async (req, res) => {
    const tab = req.params.tab as SportTab;
    if (!TAB_BUILDERS[tab]) {
      res.status(404).json({
        success: false,
        error: "tab desconocido",
        tabs: Object.keys(TAB_BUILDERS),
      });
      return;
    }
    try {
      const { matches, cache } = await getTabMatches(tab);
      res.setHeader("X-SportSrc-Cache", cache);
      res.setHeader("Cache-Control", "public, max-age=60");
      res.json({ success: true, tab, total: matches.length, matches });
    } catch (e) {
      res.status(502).json({
        success: false,
        error: e instanceof Error ? e.message : "sports tab error",
      });
    }
  });

  return router;
}
