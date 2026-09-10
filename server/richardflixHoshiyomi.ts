/**
 * Hoshiyomi platforms — plan PRE/Starter+ desbloquea DramaBox y premium.
 */
import type { Request, Response, Router } from "express";

const HOSHIYOMI_BASE = "https://api.hoshiyomi.my.id";

/** Todas las plataformas del plan PRE (free + STARTER+). Path = segmento /api/{id}/… */
export const HOSHIYOMI_PLATFORMS = [
  "dramaboxv2",
  "pinedrama",
  "netshort",
  "idrama",
  "stardusttv",
  "flickreels",
  "freereels",
  "flareflow",
  "dramawave",
  "goodshort",
  "dramabite",
  "starshort",
  "playlet",
  "melolo",
  "shortmax",
  "reelshort",
  "moboreels",
  "dramanova",
  "iqiyi",
  "wetv",
] as const;

/** @deprecated alias */
export const HOSHIYOMI_FREE_PLATFORMS = HOSHIYOMI_PLATFORMS;

export type HoshiyomiPlatform = (typeof HOSHIYOMI_PLATFORMS)[number];

const PLATFORM_LABEL: Record<string, string> = {
  dramaboxv2: "DramaBox",
  pinedrama: "PineDrama",
  netshort: "NetShort",
  idrama: "iDrama",
  stardusttv: "StardustTV",
  flickreels: "FlickReels",
  freereels: "FreeReels",
  flareflow: "FlareFlow",
  dramawave: "DramaWave",
  goodshort: "GoodShort",
  dramabite: "DramaBite",
  starshort: "StarShort",
  playlet: "Playlet",
  melolo: "Melolo",
  shortmax: "ShortMax",
  reelshort: "ReelShort",
  moboreels: "MoboReels",
  dramanova: "DramaNova",
  iqiyi: "iQIYI",
  wetv: "WeTV",
};

type CacheEntry = { body: unknown; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const CACHE_MAX = 120;

export type TrialDramaCard = {
  id: string;
  title: string;
  cover: string;
  introduction: string;
  provider: HoshiyomiPlatform;
  providerLabel: string;
  episodeCount?: number;
};
export type TrialEpisode = {
  index: number;
  episode: number;
  chapterId: string;
  name: string;
  quality?: number;
  url?: string;
  locked?: boolean;
};

function apiKey(): string {
  return (
    process.env.HOSHIYOMI_API_KEY?.trim() ||
    process.env.DRAMABOX_ASIA_API_KEY?.trim() ||
    ""
  );
}

function cacheGet<T>(key: string): T | null {
  const hit = cache.get(key);
  if (!hit || hit.expiresAt < Date.now()) {
    if (hit) cache.delete(key);
    return null;
  }
  return hit.body as T;
}

function cacheSet(key: string, body: unknown, ttlMs: number): void {
  if (cache.size >= CACHE_MAX) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (v.expiresAt < now) cache.delete(k);
    }
    while (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }
  cache.set(key, { body, expiresAt: Date.now() + ttlMs });
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function isPlatform(p: string): p is HoshiyomiPlatform {
  return (HOSHIYOMI_PLATFORMS as readonly string[]).includes(p);
}

async function hoshiFetch(path: string): Promise<unknown> {
  const key = apiKey();
  if (!key) throw new Error("HOSHIYOMI_API_KEY no configurada");

  const url = `${HOSHIYOMI_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    headers: {
      "X-API-Key": key,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Hoshiyomi respuesta no JSON (${res.status})`);
  }
  const rec = asRecord(body);
  if (!res.ok || rec?.status === false) {
    const msg =
      (typeof rec?.message === "string" && rec.message) ||
      (typeof rec?.error === "string" && rec.error) ||
      `HTTP ${res.status}`;
    const err = new Error(msg) as Error & { code?: string; status?: number };
    err.code = typeof rec?.error === "string" ? rec.error : undefined;
    err.status = res.status;
    throw err;
  }
  return body;
}

function listFromTrending(raw: unknown): unknown[] {
  const r = asRecord(raw);
  if (!r) return [];
  if (Array.isArray(r.items)) return r.items;
  if (Array.isArray(r.data)) return r.data;
  if (Array.isArray(r.results)) return r.results;
  return [];
}

function normalizeCard(raw: unknown, provider: HoshiyomiPlatform): TrialDramaCard | null {
  const r = asRecord(raw);
  if (!r) return null;
  const id = String(r.id ?? r.bookId ?? r.dramaId ?? "").trim();
  if (!id) return null;
  const title = String(r.title ?? r.bookName ?? r.name ?? "Drama").trim();
  const cover = String(r.cover ?? r.coverWap ?? r.picUrl ?? "").trim();
  const introduction = String(r.description ?? r.desc ?? r.introduction ?? "").trim();
  const episodes =
    Number(r.episodes ?? r.episodeCount ?? r.chapterCount ?? r.totalEpisodes ?? 0) || undefined;
  return {
    id,
    title,
    cover,
    introduction,
    provider,
    providerLabel: PLATFORM_LABEL[provider] || provider,
    episodeCount: episodes,
  };
}

function pickVideoUrl(ep: Record<string, unknown>): string | undefined {
  const direct = [ep.videoUrl, ep.videoPath, ep.url, ep.playUrl, ep.m3u8, ep.mp4, ep.hlsUrl, ep.hls];
  for (const v of direct) {
    if (typeof v === "string" && (v.startsWith("http") || v.startsWith("/api/"))) return v;
  }
  const stream = asRecord(ep.stream) || asRecord(ep.video);
  if (stream) {
    for (const k of ["url", "mp4", "m3u8", "videoUrl", "videoPath", "hlsUrl"]) {
      const v = stream[k];
      if (typeof v === "string" && (v.startsWith("http") || v.startsWith("/api/"))) return v;
    }
  }
  const qualities = ep.qualityList;
  if (Array.isArray(qualities)) {
    for (const q of qualities) {
      const qr = asRecord(q);
      const u = qr?.url || qr?.videoUrl || qr?.playUrl || qr?.hlsUrl;
      if (typeof u === "string" && (u.startsWith("http") || u.startsWith("/api/"))) return u;
    }
  }
  return undefined;
}

/** Resuelve /api/... relativo o playlist HLS de Hoshiyomi a URL directa (CDN). */
async function resolvePlayableUrl(rawUrl: string): Promise<string> {
  let url = rawUrl.trim();
  if (url.startsWith("/")) {
    url = `${HOSHIYOMI_BASE}${url}`;
  }
  // Si ya es CDN directo, listo
  if (!url.includes("hoshiyomi.my.id") && !url.includes("/api/dramabox")) {
    return url;
  }

  const key = apiKey();
  const res = await fetch(url, {
    headers: {
      "X-API-Key": key,
      Accept: "*/*",
    },
  });
  if (!res.ok) {
    throw new Error(`No se pudo resolver stream (${res.status})`);
  }
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  const text = await res.text();
  if (ct.includes("mpegurl") || text.trimStart().startsWith("#EXTM3U")) {
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const t = line.trim();
      if (t.startsWith("http://") || t.startsWith("https://")) return t;
    }
  }
  // JSON con url embebida
  try {
    const body = JSON.parse(text) as unknown;
    const rec = asRecord(body);
    const data = asRecord(rec?.data) || rec;
    if (data) {
      const found = pickVideoUrl(data);
      if (found && found !== rawUrl) return resolvePlayableUrl(found);
    }
  } catch {
    /* no JSON */
  }
  // Último recurso: devolver URL autenticable solo en server (no al client)
  return url;
}

function normalizeEpisodes(raw: unknown): TrialEpisode[] {
  const r = asRecord(raw);
  let list: unknown[] = [];
  if (Array.isArray(raw)) list = raw;
  else if (r) {
    if (Array.isArray(r.episodes)) list = r.episodes;
    else if (Array.isArray(r.data)) list = r.data;
    else if (Array.isArray(r.list)) list = r.list;
    else if (r.episodes && typeof r.episodes === "object") list = Object.values(r.episodes);
  }

  const mapped = list.map((item, i) => {
    const ep = asRecord(item) || {};
    const rawNum = Number(ep.number ?? ep.episode ?? ep.chapterIndex);
    const episode = Number.isFinite(rawNum) && rawNum >= 0 ? (rawNum >= 1 ? rawNum : rawNum + 1) : i + 1;
    const url = pickVideoUrl(ep);
    const lockedFlag = ep.locked === true || ep.isCharge === 1 || ep.isPay === 1;
    return {
      index: episode - 1,
      episode,
      chapterId: String(ep.videoId ?? ep.chapterId ?? ep.id ?? episode),
      name: String(ep.name ?? ep.chapterName ?? `Episodio ${episode}`),
      quality: typeof ep.quality === "number" ? ep.quality : undefined,
      url,
      locked: Boolean(lockedFlag) || !url,
    } satisfies TrialEpisode;
  });

  return mapped.sort((a, b) => a.episode - b.episode);
}

function isSpanishDubTitle(title: string): boolean {
  return /\[\s*doblad[oa]\s*\]|\(\s*doblad[oa]\s*\)|\bdoblad[oa]\b|\bdublad[oa]\b/i.test(title);
}

/** Plataformas que mezclan original EN + doblaje: solo mostrar dobladas. */
const DUB_FILTER_PROVIDERS = new Set<string>([
  "dramaboxv2",
  "shortmax",
  "reelshort",
  "melolo",
  "moboreels",
  "dramanova",
]);

export async function fetchTrialTrending(provider: HoshiyomiPlatform, lang = "es"): Promise<TrialDramaCard[]> {
  const key = `hoshi:trending:${provider}:${lang}:dubv1`;
  const hit = cacheGet<TrialDramaCard[]>(key);
  if (hit) return hit;

  const raw = await hoshiFetch(`/api/${provider}/trending?lang=${encodeURIComponent(lang)}`);
  let items = listFromTrending(raw)
    .map((x) => normalizeCard(x, provider))
    .filter((x): x is TrialDramaCard => Boolean(x));

  if (DUB_FILTER_PROVIDERS.has(provider)) {
    const dubbed = items.filter((x) => isSpanishDubTitle(x.title));
    if (dubbed.length) items = dubbed;
  }

  cacheSet(key, items, 30 * 60 * 1000);
  return items;
}

export async function fetchTrialHome(lang = "es"): Promise<{
  rows: Array<{ provider: string; label: string; items: TrialDramaCard[] }>;
  hasKey: boolean;
}> {
  if (!apiKey()) {
    return { rows: [], hasKey: false };
  }

  const cacheKey = `hoshi:home:es-dub:${lang}`;
  const hit = cacheGet<{ rows: Array<{ provider: string; label: string; items: TrialDramaCard[] }> }>(cacheKey);
  if (hit) return { ...hit, hasKey: true };

  // Primero plataformas que en trial sonaban en español; dobladas premium después
  const preferred: HoshiyomiPlatform[] = [
    "pinedrama",
    "netshort",
    "idrama",
    "stardusttv",
    "flickreels",
    "freereels",
    "goodshort",
    "shortmax",
    "dramaboxv2",
    "reelshort",
  ];

  const settled = await Promise.allSettled(
    preferred.map(async (provider) => {
      const items = await fetchTrialTrending(provider, lang);
      return {
        provider,
        label: PLATFORM_LABEL[provider] || provider,
        items,
      };
    }),
  );

  const rows: Array<{ provider: string; label: string; items: TrialDramaCard[] }> = [];
  for (const r of settled) {
    if (r.status === "fulfilled" && r.value.items.length) {
      rows.push(r.value);
    } else if (r.status === "rejected") {
      console.warn(`[hoshiyomi] trending:`, r.reason instanceof Error ? r.reason.message : r.reason);
    }
  }

  const body = { rows };
  cacheSet(cacheKey, body, 20 * 60 * 1000);
  return { ...body, hasKey: true };
}

export async function fetchTrialDetail(
  provider: HoshiyomiPlatform,
  id: string,
  lang = "es",
): Promise<{
  drama: TrialDramaCard & {
    totalEpisodes: number;
    available: number;
    seriesTotal: number;
    episodes: TrialEpisode[];
    source: "hoshiyomi";
  };
}> {
  const cacheKey = `hoshi:detail:${provider}:${id}:${lang}`;
  const hit = cacheGet<{
    drama: TrialDramaCard & {
      totalEpisodes: number;
      available: number;
      seriesTotal: number;
      episodes: TrialEpisode[];
      source: "hoshiyomi";
    };
  }>(cacheKey);
  if (hit) return hit;

  let meta: TrialDramaCard | null = null;
  try {
    const detail = await hoshiFetch(
      `/api/${provider}/detail?id=${encodeURIComponent(id)}&lang=${encodeURIComponent(lang)}`,
    );
    meta = normalizeCard(asRecord(detail)?.data ?? detail, provider) || normalizeCard(detail, provider);
  } catch {
    /* algunas plataformas no tienen detail */
  }

  if (!meta) {
    const trending = await fetchTrialTrending(provider, lang);
    meta = trending.find((t) => t.id === id) || {
      id,
      title: `Drama ${id}`,
      cover: "",
      introduction: "",
      provider,
      providerLabel: PLATFORM_LABEL[provider] || provider,
    };
  }

  let episodes: TrialEpisode[] = [];
  try {
    const raw = await hoshiFetch(
      `/api/${provider}/allepisode?id=${encodeURIComponent(id)}&lang=${encodeURIComponent(lang)}`,
    );
    episodes = normalizeEpisodes(asRecord(raw)?.data ?? raw);
  } catch (e) {
    console.warn(`[hoshiyomi] allepisode ${provider}/${id}:`, e instanceof Error ? e.message : e);
  }

  const available = episodes.filter((e) => e.url && !e.locked).length;
  const seriesTotal = Math.max(episodes.length, meta.episodeCount || 0, available);
  const body = {
    drama: {
      ...meta,
      totalEpisodes: available,
      available,
      seriesTotal,
      episodes,
      source: "hoshiyomi" as const,
    },
  };
  cacheSet(cacheKey, body, 15 * 60 * 1000);
  return body;
}

export async function fetchTrialStream(
  provider: HoshiyomiPlatform,
  id: string,
  episode: number,
  lang = "es",
): Promise<{
  bookId: string;
  episode: number;
  allEps: number;
  seriesTotal: number;
  quality: number;
  source: string;
  type: "mp4" | "hls";
  url: string;
  provider: string;
}> {
  const { drama } = await fetchTrialDetail(provider, id, lang);
  const ep = drama.episodes.find((e) => e.episode === episode);

  if (!ep?.url || ep.locked) {
    const err = new Error(
      ep?.locked ? "Episodio bloqueado en esta plataforma" : "Sin URL de reproducción",
    ) as Error & { code?: string };
    if (ep?.locked) err.code = "LOCKED";
    throw err;
  }

  const resolved = await resolvePlayableUrl(ep.url);
  return {
    bookId: id,
    episode,
    allEps: drama.available || drama.seriesTotal,
    seriesTotal: drama.seriesTotal,
    quality: ep.quality || 0,
    source: "hoshiyomi",
    type: resolved.includes(".m3u8") ? "hls" : "mp4",
    url: resolved,
    provider,
  };
}

export function mountRichardflixHoshiyomi(router: Router): void {
  router.get("/dramas/trial/home", async (req: Request, res: Response) => {
    try {
      const lang = typeof req.query.lang === "string" ? req.query.lang : "es";
      const home = await fetchTrialHome(lang);
      res.setHeader("Cache-Control", "public, max-age=120");
      res.json({ success: true, language: lang, plan: "pre", ...home });
    } catch (e) {
      res.status(502).json({
        success: false,
        error: e instanceof Error ? e.message : "trial home error",
      });
    }
  });

  router.get("/dramas/trial/:provider/trending", async (req: Request, res: Response) => {
    const provider = String(req.params.provider || "").toLowerCase();
    if (!isPlatform(provider)) {
      res.status(400).json({
        success: false,
        error: "provider no soportado",
        providers: HOSHIYOMI_PLATFORMS,
      });
      return;
    }
    try {
      const lang = typeof req.query.lang === "string" ? req.query.lang : "es";
      const items = await fetchTrialTrending(provider, lang);
      res.setHeader("Cache-Control", "public, max-age=180");
      res.json({ success: true, provider, total: items.length, items });
    } catch (e) {
      const status = (e as Error & { status?: number }).status || 502;
      res.status(status >= 400 && status < 600 ? status : 502).json({
        success: false,
        error: e instanceof Error ? e.message : "trial trending error",
      });
    }
  });

  router.get("/dramas/trial/:provider/:id/stream", async (req: Request, res: Response) => {
    const provider = String(req.params.provider || "").toLowerCase();
    const id = String(req.params.id || "").trim();
    const episode = Math.max(1, Number(req.query.ep) || 1);
    if (!isPlatform(provider) || !id) {
      res.status(400).json({ success: false, error: "provider e id requeridos" });
      return;
    }
    try {
      const lang = typeof req.query.lang === "string" ? req.query.lang : "es";
      const stream = await fetchTrialStream(provider, id, episode, lang);
      res.setHeader("Cache-Control", "public, max-age=60");
      res.json({ success: true, ...stream });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "trial stream error";
      const locked = (e as Error & { code?: string }).code === "LOCKED";
      res.status(locked ? 423 : 502).json({ success: false, locked, error: msg });
    }
  });

  router.get("/dramas/trial/:provider/:id", async (req: Request, res: Response) => {
    const provider = String(req.params.provider || "").toLowerCase();
    const id = String(req.params.id || "").trim();
    if (!isPlatform(provider) || !id) {
      res.status(400).json({ success: false, error: "provider e id requeridos" });
      return;
    }
    try {
      const lang = typeof req.query.lang === "string" ? req.query.lang : "es";
      const detail = await fetchTrialDetail(provider, id, lang);
      res.setHeader("Cache-Control", "public, max-age=120");
      res.json({ success: true, ...detail });
    } catch (e) {
      res.status(502).json({
        success: false,
        error: e instanceof Error ? e.message : "trial detail error",
      });
    }
  });
}
