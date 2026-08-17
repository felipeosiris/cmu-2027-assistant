/**
 * TV / radio en vivo para RichardFlix.
 * Dataset público MIT de Famelack (IPTV-org + YouTube Live + radio curada).
 * No scrapeamos famelack.com: solo GitHub/jsDelivr.
 */
import type { Request, Response, Router } from "express";

const DATA_BASES = [
  "https://cdn.jsdelivr.net/gh/famelack/famelack-data@main",
  "https://raw.githubusercontent.com/famelack/famelack-data/main",
] as const;

type Kind = "tv" | "radio";

type CacheEntry = { body: unknown; fetchedAt: number; expiresAt: number };

const memoryCache = new Map<string, CacheEntry>();
const TTL_MS = 30 * 60 * 1000;

type RawChannel = {
  nanoid?: string;
  name?: string;
  languages?: string[];
  country?: string;
  isGeoBlocked?: boolean;
  sources?: {
    streams?: string[];
    youtube?: string[];
  };
};

export type LiveChannel = {
  id: string;
  name: string;
  country: string;
  languages: string[];
  geoBlocked: boolean;
  kind: Kind;
  playType: "youtube" | "hls" | "audio";
  sources: Array<{ type: "youtube" | "hls" | "audio"; url: string }>;
};

type CountryMeta = {
  code: string;
  name: string;
  capital?: string;
  channelCount: number;
};

function getCached(key: string): unknown | null {
  const hit = memoryCache.get(key);
  if (!hit || hit.expiresAt < Date.now()) return null;
  return hit.body;
}

function setCached(key: string, body: unknown): void {
  const now = Date.now();
  memoryCache.set(key, { body, fetchedAt: now, expiresAt: now + TTL_MS });
}

function isHttpsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

function isYoutube(url: string): boolean {
  const h = url.toLowerCase();
  return h.includes("youtube.com") || h.includes("youtube-nocookie.com") || h.includes("youtu.be");
}

function isHls(url: string): boolean {
  const p = url.toLowerCase();
  return p.includes(".m3u8") || p.includes("/playlist.m3u8") || p.includes("format=m3u8");
}

function playTypeFor(urls: { youtube: string[]; streams: string[] }, kind: Kind): LiveChannel["playType"] {
  if (urls.youtube.length) return "youtube";
  if (urls.streams.some(isHls) || kind === "tv") return "hls";
  return "audio";
}

function normalizeChannel(raw: RawChannel, kind: Kind, fallbackCountry: string): LiveChannel | null {
  const id = String(raw.nanoid || "").trim();
  const name = String(raw.name || "").trim();
  if (!id || !name) return null;

  const youtube = (raw.sources?.youtube || []).filter(isHttpsUrl).filter(isYoutube);
  const streams = (raw.sources?.streams || []).filter(isHttpsUrl);
  if (!youtube.length && !streams.length) return null;

  const sources: LiveChannel["sources"] = [
    ...youtube.map((url) => ({ type: "youtube" as const, url })),
    ...streams.map((url) => ({
      type: (isHls(url) || kind === "tv" ? "hls" : "audio") as "hls" | "audio",
      url,
    })),
  ];

  return {
    id,
    name,
    country: String(raw.country || fallbackCountry).toLowerCase(),
    languages: Array.isArray(raw.languages) ? raw.languages.map(String) : [],
    geoBlocked: Boolean(raw.isGeoBlocked),
    kind,
    playType: playTypeFor({ youtube, streams }, kind),
    sources,
  };
}

async function fetchJson(path: string): Promise<unknown> {
  const cached = getCached(path);
  if (cached) return cached;

  let lastErr: Error | null = null;
  for (const base of DATA_BASES) {
    try {
      const res = await fetch(`${base}${path}`, {
        headers: {
          Accept: "application/json",
          "User-Agent": "RichardFlixLiveTv/1.0",
        },
      });
      if (!res.ok) {
        lastErr = new Error(`${base} ${res.status}`);
        continue;
      }
      const body = (await res.json()) as unknown;
      setCached(path, body);
      return body;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastErr || new Error("dataset unavailable");
}

function countryCode(raw: string): string | null {
  const cc = raw.trim().toLowerCase();
  return /^[a-z]{2}$/.test(cc) ? cc : null;
}

async function listCountries(): Promise<CountryMeta[]> {
  const body = (await fetchJson("/tv/raw/countries_metadata.json")) as Record<
    string,
    { country?: string; capital?: string; hasChannels?: boolean; channelCount?: number }
  >;
  const out: CountryMeta[] = [];
  for (const [code, meta] of Object.entries(body || {})) {
    if (!meta?.hasChannels) continue;
    const cc = countryCode(code);
    if (!cc) continue;
    out.push({
      code: cc,
      name: String(meta.country || cc.toUpperCase()),
      capital: typeof meta.capital === "string" ? meta.capital : undefined,
      channelCount: Number(meta.channelCount) || 0,
    });
  }
  return out.sort((a, b) => {
    if (a.code === "mx") return -1;
    if (b.code === "mx") return 1;
    return a.name.localeCompare(b.name, "es");
  });
}

async function listChannels(kind: Kind, cc: string): Promise<LiveChannel[]> {
  const path = `/${kind}/raw/countries/${cc}.json`;
  const body = (await fetchJson(path)) as RawChannel[];
  if (!Array.isArray(body)) return [];
  const out: LiveChannel[] = [];
  const seen = new Set<string>();
  for (const raw of body) {
    const ch = normalizeChannel(raw, kind, cc);
    if (!ch || seen.has(ch.id)) continue;
    seen.add(ch.id);
    out.push(ch);
  }
  return out.sort((a, b) => {
    const ya = a.playType === "youtube" ? 0 : 1;
    const yb = b.playType === "youtube" ? 0 : 1;
    if (ya !== yb) return ya - yb;
    return a.name.localeCompare(b.name, "es");
  });
}

export function mountRichardflixLiveTv(router: Router): void {
  router.get("/tv/countries", async (_req: Request, res: Response) => {
    try {
      const countries = await listCountries();
      res.setHeader("Cache-Control", "public, max-age=300");
      res.json({ success: true, total: countries.length, countries });
    } catch (e) {
      res.status(502).json({
        success: false,
        error: e instanceof Error ? e.message : "tv countries error",
      });
    }
  });

  router.get("/tv/channels", async (req: Request, res: Response) => {
    const cc = countryCode(String(req.query.country || "mx"));
    const kind: Kind = req.query.kind === "radio" ? "radio" : "tv";
    if (!cc) {
      res.status(400).json({ success: false, error: "country inválido" });
      return;
    }
    try {
      const channels = await listChannels(kind, cc);
      res.setHeader("Cache-Control", "public, max-age=180");
      res.json({ success: true, kind, country: cc, total: channels.length, channels });
    } catch (e) {
      res.status(502).json({
        success: false,
        error: e instanceof Error ? e.message : "tv channels error",
      });
    }
  });

  router.get("/tv/channel", async (req: Request, res: Response) => {
    const cc = countryCode(String(req.query.country || "mx"));
    const kind: Kind = req.query.kind === "radio" ? "radio" : "tv";
    const id = String(req.query.id || "").trim();
    if (!cc || !id) {
      res.status(400).json({ success: false, error: "country e id requeridos" });
      return;
    }
    try {
      const channels = await listChannels(kind, cc);
      const channel = channels.find((c) => c.id === id);
      if (!channel) {
        res.status(404).json({ success: false, error: "canal no encontrado" });
        return;
      }
      res.setHeader("Cache-Control", "public, max-age=120");
      res.json({ success: true, channel });
    } catch (e) {
      res.status(502).json({
        success: false,
        error: e instanceof Error ? e.message : "tv channel error",
      });
    }
  });
}
