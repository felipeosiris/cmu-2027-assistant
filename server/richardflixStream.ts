/**
 * RichardFlix VOD — scrape UnlimPlay EMBEDS + resolución m3u8/mp4 + proxy HLS.
 */
import { createHash } from "node:crypto";
import type { Request, Response, Router } from "express";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const UNLIM = "https://unlimplay.com";

export type StreamLang = "latino" | "espanol" | "subtitulado";
export type StreamMediaType = "movie" | "tv";

const HOST_PRIORITY = [
  "direct",
  "remux",
  "netu",
  "netu2",
  "filelions",
  "vidhide",
  "filemoon",
  "streamwish",
  "streamwish 2",
  "voe",
  "voe 2",
  "doodstream",
  "streamtape",
] as const;

type EmbedsMap = Record<string, Record<string, string>>;

type ResolvedStream = {
  mode: "hls-direct" | "hls-proxy" | "mp4-direct" | "mp4-proxy" | "embed";
  url: string;
  referer: string;
  host: string;
  lang: StreamLang;
  validated: boolean;
};

type CacheEntry = { body: unknown; expiresAt: number };
const cache = new Map<string, CacheEntry>();

function cacheGet<T>(key: string): T | null {
  const hit = cache.get(key);
  if (!hit || hit.expiresAt < Date.now()) return null;
  return hit.body as T;
}

function cacheSet(key: string, body: unknown, ttlMs: number): void {
  cache.set(key, { body, expiresAt: Date.now() + ttlMs });
}

function b64urlEncode(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

function b64urlDecode(s: string): string {
  return Buffer.from(s, "base64url").toString("utf8");
}

function embedPagePath(opts: {
  type: StreamMediaType;
  tmdbId: number;
  season?: number;
  episode?: number;
}): string {
  const { type, tmdbId, season = 1, episode = 1 } = opts;
  if (type === "movie") return `/f/embed/movie/${tmdbId}`;
  return `/f/embed/tv/${tmdbId}/${season}/${episode}`;
}

function embedReferer(opts: {
  type: StreamMediaType;
  tmdbId: number;
  season?: number;
  episode?: number;
}): string {
  return `${UNLIM}${embedPagePath(opts)}`;
}

async function fetchText(url: string, referer: string): Promise<{ text: string; finalUrl: string; status: number }> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,*/*",
      Referer: referer,
      "Accept-Language": "es-MX,es;q=0.9",
    },
    redirect: "follow",
  });
  const text = await res.text();
  return { text, finalUrl: res.url, status: res.status };
}

export async function fetchUnlimEmbeds(opts: {
  type: StreamMediaType;
  tmdbId: number;
  season?: number;
  episode?: number;
}): Promise<EmbedsMap | null> {
  const key = `emb:${opts.type}:${opts.tmdbId}:${opts.season ?? 1}:${opts.episode ?? 1}`;
  const cached = cacheGet<EmbedsMap>(key);
  if (cached) return cached;

  const path = embedPagePath(opts);
  const referer = `${UNLIM}/`;
  const { text, status } = await fetchText(`${UNLIM}${path}`, referer);
  if (status >= 400) return null;

  const m = text.match(/const EMBEDS = (\{.*?\});/s);
  if (!m) return null;

  try {
    const data = JSON.parse(m[1]) as EmbedsMap;
    cacheSet(key, data, 20 * 60 * 1000);
    return data;
  } catch {
    return null;
  }
}

function extractM3u8(html: string): string | null {
  const hits = html.match(/https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*/g);
  return hits?.[0] ?? null;
}

function extractMp4(html: string): string | null {
  const hits = html.match(/https?:\/\/[^\s"'<>\\]+\.mp4[^\s"'<>\\]*/g);
  return hits?.find((u) => !u.includes("image.tmdb")) ?? null;
}

async function resolveWaaw(embedUrl: string, referer: string): Promise<string | null> {
  const vid = embedUrl.match(/waaw\.to\/f\/([^/?]+)/i)?.[1];
  if (!vid) return null;
  const inner = `https://waaw.to/e/${vid}?http_referer=${encodeURIComponent(referer)}&autoplay=no&embed_from=embed_from`;
  const { text } = await fetchText(inner, `https://waaw.to/f/${vid}`);
  return extractM3u8(text);
}

async function resolveAjaxFileHost(embedUrl: string, referer: string): Promise<string | null> {
  const { text, finalUrl } = await fetchText(embedUrl, referer);
  const inline = extractM3u8(text) ?? extractMp4(text);
  if (inline) return inline;

  const fileCode =
    finalUrl.match(/\/(?:e|v|embed)\/([a-zA-Z0-9]+)/i)?.[1] ??
    text.match(/file_code\s*=\s*["']([^"']+)/i)?.[1];
  if (!fileCode) return null;

  const host = new URL(finalUrl).hostname;
  const apis = [
    `https://${host}/ajax/embed/get?id=${fileCode}`,
    `https://${host}/ajax/b/embed/get?id=${fileCode}`,
    `https://${host}/api/source/${fileCode}`,
    `https://${host}/mediainfo/${fileCode}`,
  ];

  for (const api of apis) {
    try {
      const res = await fetch(api, {
        method: "POST",
        headers: {
          "User-Agent": UA,
          Referer: finalUrl,
          "X-Requested-With": "XMLHttpRequest",
          Accept: "application/json, text/plain, */*",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `id=${encodeURIComponent(fileCode)}`,
      });
      const body = await res.text();
      const fromText = extractM3u8(body) ?? extractMp4(body);
      if (fromText) return fromText;
      try {
        const j = JSON.parse(body) as Record<string, unknown>;
        for (const k of ["file", "source", "url", "link", "hls"]) {
          const v = j[k];
          if (typeof v === "string" && (v.includes(".m3u8") || v.includes(".mp4"))) return v;
        }
        const sources = j.sources;
        if (Array.isArray(sources)) {
          for (const s of sources) {
            if (s && typeof s === "object" && "file" in s && typeof (s as { file: string }).file === "string") {
              return (s as { file: string }).file;
            }
          }
        }
      } catch {
        /* ignore */
      }
    } catch {
      /* next api */
    }
  }
  return null;
}

async function resolveHostStream(
  host: string,
  embedUrl: string,
  referer: string,
): Promise<{ streamUrl: string | null; kind: "hls" | "mp4" | "embed" }> {
  if (host === "direct") {
    if (/\.m3u8/i.test(embedUrl)) return { streamUrl: embedUrl, kind: "hls" };
    if (/\.mp4/i.test(embedUrl)) return { streamUrl: embedUrl, kind: "mp4" };
    return { streamUrl: null, kind: "embed" };
  }

  if (host === "remux") {
    return { streamUrl: null, kind: "embed" };
  }

  if (host === "netu" || host === "netu2" || /waaw\.to/i.test(embedUrl)) {
    const m3u8 = await resolveWaaw(embedUrl, referer);
    return { streamUrl: m3u8, kind: m3u8 ? "hls" : "embed" };
  }

  const streamUrl = await resolveAjaxFileHost(embedUrl, referer);
  if (!streamUrl) return { streamUrl: null, kind: "embed" };
  if (streamUrl.includes(".m3u8")) return { streamUrl, kind: "hls" };
  if (streamUrl.includes(".mp4")) return { streamUrl, kind: "mp4" };
  return { streamUrl: null, kind: "embed" };
}

async function validateStream(url: string, referer: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": UA, Referer: referer, Accept: "*/*", Range: "bytes=0-2048" },
    });
    if (!res.ok) return false;
    const sample = await res.text();
    return sample.includes("#EXTM3U") || sample.includes("#EXT-X-") || url.includes(".mp4");
  } catch {
    return false;
  }
}

function proxyUrlFor(target: string, referer: string, req: Request): string {
  const base = `${req.protocol}://${req.get("host")}/rf/stream/proxy`;
  return `${base}?u=${b64urlEncode(target)}&r=${b64urlEncode(referer)}`;
}

function packResolved(
  streamUrl: string,
  kind: "hls" | "mp4",
  referer: string,
  host: string,
  lang: StreamLang,
  validated: boolean,
  req: Request,
): ResolvedStream {
  const isHls = kind === "hls";
  const useDirect = isHls && (host === "direct" || !validated);
  if (useDirect) {
    return {
      mode: isHls ? "hls-direct" : "mp4-direct",
      url: streamUrl,
      referer,
      host,
      lang,
      validated,
    };
  }
  return {
    mode: isHls ? "hls-proxy" : "mp4-proxy",
    url: proxyUrlFor(streamUrl, referer, req),
    referer,
    host,
    lang,
    validated,
  };
}

export async function resolvePlayableStream(
  req: Request,
  opts: {
    type: StreamMediaType;
    tmdbId: number;
    season?: number;
    episode?: number;
    lang: StreamLang;
    hostIndex?: number;
  },
): Promise<ResolvedStream | { mode: "embed"; url: string; referer: string; host: string; lang: StreamLang } | null> {
  const embeds = await fetchUnlimEmbeds(opts);
  if (!embeds) return null;

  const track = embeds[opts.lang];
  if (!track || typeof track !== "object") return null;

  const referer = embedReferer(opts);
  const ordered = HOST_PRIORITY.filter((h) => track[h]).map((h) => [h, track[h]] as const);
  const extras = Object.entries(track).filter(([h]) => !HOST_PRIORITY.includes(h as (typeof HOST_PRIORITY)[number]));
  const allHosts = [...ordered, ...extras.filter(([k]) => k !== "searched_names")];

  const idx = Math.max(0, opts.hostIndex ?? 0);
  const slice = allHosts.slice(idx);

  for (const [host, embedUrl] of slice) {
    if (typeof embedUrl !== "string" || !embedUrl.startsWith("http")) continue;

    const { streamUrl, kind } = await resolveHostStream(host, embedUrl, referer);

    if (streamUrl && (kind === "hls" || kind === "mp4")) {
      const validated = await validateStream(streamUrl, referer);
      if (validated || host === "direct") {
        return packResolved(streamUrl, kind, referer, host, opts.lang, validated, req);
      }
      if (kind === "hls") {
        return packResolved(streamUrl, kind, referer, host, opts.lang, false, req);
      }
    }
  }

  for (const [host, embedUrl] of slice) {
    if (typeof embedUrl !== "string" || !embedUrl.startsWith("http")) continue;
    if (host === "direct" || host === "remux") continue;
    return { mode: "embed", url: embedUrl, referer, host, lang: opts.lang };
  }

  const first = allHosts[0];
  if (first) {
    const [host, embedUrl] = first;
    return { mode: "embed", url: embedUrl, referer, host, lang: opts.lang };
  }
  return null;
}

function rewriteM3u8(body: string, targetUrl: string, referer: string, req: Request): string {
  const base = new URL(targetUrl);
  return body
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        if (trimmed.startsWith("#") && trimmed.includes('URI="')) {
          return trimmed.replace(/URI="([^"]+)"/g, (_m, uri: string) => {
            const abs = new URL(uri, base).href;
            return `URI="${proxyUrlFor(abs, referer, req)}"`;
          });
        }
        return line;
      }
      const abs = new URL(trimmed, base).href;
      return proxyUrlFor(abs, referer, req);
    })
    .join("\n");
}

export function mountRichardflixStream(router: Router): void {
  router.get("/stream/sources", async (req, res) => {
    const type = req.query.type === "tv" ? "tv" : "movie";
    const tmdbId = Number(req.query.tmdb);
    const season = Number(req.query.season || 1);
    const episode = Number(req.query.episode || 1);
    const lang = (String(req.query.lang || "latino").toLowerCase() as StreamLang) || "latino";

    if (!tmdbId || Number.isNaN(tmdbId)) {
      res.status(400).json({ ok: false, error: "tmdb requerido" });
      return;
    }

    try {
      const embeds = await fetchUnlimEmbeds({ type, tmdbId, season, episode });
      if (!embeds) {
        res.status(404).json({ ok: false, error: "sin fuentes" });
        return;
      }
      const track = embeds[lang] ?? embeds.latino;
      const hosts = track && typeof track === "object" ? Object.keys(track).filter((k) => k !== "searched_names") : [];
      res.setHeader("Cache-Control", "public, max-age=300");
      res.json({
        ok: true,
        lang,
        langs: Object.keys(embeds).filter((k) => k !== "searched_names"),
        hosts,
        track,
      });
    } catch (e) {
      res.status(502).json({ ok: false, error: e instanceof Error ? e.message : "sources error" });
    }
  });

  router.get("/stream/play", async (req, res) => {
    const type = req.query.type === "tv" ? "tv" : "movie";
    const tmdbId = Number(req.query.tmdb);
    const season = Number(req.query.season || 1);
    const episode = Number(req.query.episode || 1);
    const langRaw = String(req.query.lang || "latino").toLowerCase();
    const lang: StreamLang =
      langRaw === "espanol" || langRaw === "es" ? "espanol" : langRaw === "subtitulado" || langRaw === "sub" ? "subtitulado" : "latino";
    const hostIndex = Number(req.query.hostIndex || 0);

    if (!tmdbId || Number.isNaN(tmdbId)) {
      res.status(400).json({ ok: false, error: "tmdb requerido" });
      return;
    }

    try {
      const stream = await resolvePlayableStream(req, { type, tmdbId, season, episode, lang, hostIndex });
      if (!stream) {
        res.status(404).json({ ok: false, error: "no se pudo resolver stream" });
        return;
      }
      res.setHeader("Cache-Control", "public, max-age=120");
      res.json({ ok: true, ...stream, hostIndex });
    } catch (e) {
      res.status(502).json({ ok: false, error: e instanceof Error ? e.message : "play error" });
    }
  });

  router.get("/stream/proxy", async (req, res) => {
    const u = typeof req.query.u === "string" ? b64urlDecode(req.query.u) : "";
    const r = typeof req.query.r === "string" ? b64urlDecode(req.query.r) : UNLIM + "/";
    if (!u.startsWith("http")) {
      res.status(400).send("bad url");
      return;
    }

    try {
      const upstream = await fetch(u, {
        headers: {
          "User-Agent": UA,
          Referer: r,
          Accept: "*/*",
          Origin: new URL(r).origin,
        },
        redirect: "follow",
      });

      if (!upstream.ok) {
        res.status(upstream.status).send(`upstream ${upstream.status}`);
        return;
      }

      const ct = upstream.headers.get("content-type") || "";
      const buf = Buffer.from(await upstream.arrayBuffer());

      if (ct.includes("mpegurl") || ct.includes("m3u8") || buf.slice(0, 8).toString("utf8").startsWith("#EXTM3U")) {
        const text = buf.toString("utf8");
        const rewritten = rewriteM3u8(text, u, r, req);
        res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Cache-Control", "no-cache");
        res.send(rewritten);
        return;
      }

      res.setHeader("Content-Type", ct || "application/octet-stream");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.send(buf);
    } catch (e) {
      res.status(502).send(e instanceof Error ? e.message : "proxy error");
    }
  });
}
