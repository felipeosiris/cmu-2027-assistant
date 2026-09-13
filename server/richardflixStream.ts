/**
 * RichardFlix VOD — Spectre: extracción directa m3u8/mp4 (sin iframe/ads).
 * Direct-or-Nothing: nunca devuelve mode=embed en el happy path.
 */
import type { Request, Router } from "express";

/** Mismo UA Safari que el POC de Apple TV (UnlimPlayResolver). */
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

const UNLIM = "https://unlimplay.com";

export type StreamLang = "latino" | "espanol" | "subtitulado";
export type StreamMediaType = "movie" | "tv";

/** Orden: native → verdes UnlimPlay (vidhide/filelions/earnvids) → resto. */
const HOST_PRIORITY = [
  "direct",
  "remux",
  "vidhide",
  "vidhide 2",
  "filelions",
  "earnvids",
  "earnvid",
  "streamwish",
  "streamwish 2",
  "voe",
  "voe 2",
  "voe 3",
  "filemoon",
  "filemoon 2",
  "netu",
  "netu 2",
  "netu2",
  "doodstream",
  "streamtape",
  "streamhg",
  "goodstream",
] as const;

/** Hosts que casi siempre son iframe con ads → último recurso / excluidos de Spectre race. */
const IFRAME_ONLY_HOSTS = new Set([
  "doodstream",
  "dood",
  "streamtape",
  "streamhg",
  "goodstream",
  "vidsrc",
]);

const SPECTRE_RACE_SIZE = 5;
const SPECTRE_TIMEOUT_MS = 3500;

/** Historial en memoria: host → éxitos recientes (para priorizar). */
const hostWins = new Map<string, number>();

function hostBase(name: string): string {
  return name.toLowerCase().replace(/[\s_-]+\d+$/, "").trim();
}

function isIframeOnlyHost(name: string): boolean {
  return IFRAME_ONLY_HOSTS.has(hostBase(name));
}

function spectreScore(host: string): number {
  const base = hostBase(host);
  if (base === "direct") return 1000;
  if (base === "remux") return 950;
  const wins = hostWins.get(base) || 0;
  const priorityIdx = HOST_PRIORITY.findIndex((h) => hostBase(h) === base);
  const priorityBoost = priorityIdx >= 0 ? 80 - priorityIdx : 0;
  if (isIframeOnlyHost(host)) return -100 + wins;
  return 100 + wins * 10 + priorityBoost;
}

function noteHostWin(host: string): void {
  const base = hostBase(host);
  hostWins.set(base, (hostWins.get(base) || 0) + 1);
}

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
const CACHE_MAX_KEYS = 40;

function cacheGet<T>(key: string): T | null {
  const hit = cache.get(key);
  if (!hit || hit.expiresAt < Date.now()) {
    if (hit) cache.delete(key);
    return null;
  }
  return hit.body as T;
}

function cacheSet(key: string, body: unknown, ttlMs: number): void {
  if (cache.size >= CACHE_MAX_KEYS) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (v.expiresAt < now) cache.delete(k);
    }
    while (cache.size >= CACHE_MAX_KEYS) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }
  cache.set(key, { body, expiresAt: Date.now() + ttlMs });
}

function b64urlEncode(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

function b64urlDecode(s: string): string {
  return Buffer.from(s, "base64url").toString("utf8");
}

/** Best-effort: pedir sin subs / max calidad en URLs de embed. */
function tuneEmbedUrl(url: string): string {
  try {
    const u = new URL(url);
    const set = (k: string, v: string) => {
      if (!u.searchParams.has(k)) u.searchParams.set(k, v);
    };
    set("sub", "0");
    set("subtitle", "0");
    set("subtitles", "0");
    set("captions", "0");
    set("ds_lang", "off");
    set("quality", "max");
    set("q", "max");
    return u.href;
  } catch {
    return url;
  }
}

/** Quita pistas SUBTITLES del master m3u8 cuando el proxy lo pide. */
function stripSubtitleRenditions(body: string): string {
  const lines = body.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    if (/TYPE=SUBTITLES/i.test(line)) continue;
    if (line.startsWith("#EXT-X-STREAM-INF")) {
      kept.push(line.replace(/SUBTITLES="[^"]*"\s*,?\s*/gi, ""));
      continue;
    }
    kept.push(line);
  }
  return kept.join("\n");
}

function embedPagePath(opts: {
  type: StreamMediaType;
  tmdbId: number;
  season?: number;
  episode?: number;
}): string {
  const { type, tmdbId, season = 1, episode = 1 } = opts;
  // Misma ruta que Apple TV (`/play/embed/…`); UnlimPlay redirige a `/f/embed/…`.
  if (type === "movie") return `/play/embed/movie/${tmdbId}`;
  return `/play/embed/tv/${tmdbId}/${season}/${episode}`;
}

function orderedLangs(preferred: StreamLang, embeds: EmbedsMap): StreamLang[] {
  const extras = Object.keys(embeds).filter(
    (k) => k !== "searched_names" && !["latino", "espanol", "subtitulado", "español"].includes(k),
  );
  const raw = [preferred, "latino", "espanol", "subtitulado", ...extras];
  const seen = new Set<string>();
  const out: StreamLang[] = [];
  for (const lang of raw) {
    const key = lang.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (embeds[lang] || embeds[key]) out.push(lang as StreamLang);
  }
  return out.length ? out : [preferred];
}

function pickTrack(embeds: EmbedsMap, lang: StreamLang): Record<string, string> | null {
  const candidates = [lang, "latino", "espanol", "español", "subtitulado"];
  for (const key of candidates) {
    const track = embeds[key];
    if (track && typeof track === "object" && Object.keys(track).length) return track;
  }
  for (const [key, track] of Object.entries(embeds)) {
    if (key === "searched_names") continue;
    if (track && typeof track === "object" && Object.keys(track).length) return track;
  }
  return null;
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

function extractJsonObjectAfter(text: string, marker: string): string | null {
  let from = 0;
  while (from < text.length) {
    const idx = text.indexOf(marker, from);
    if (idx < 0) return null;
    const after = idx + marker.length;
    // Saltar espacios hasta el '{'
    let start = after;
    while (start < text.length && /\s/.test(text[start])) start++;
    if (text[start] !== "{") {
      from = after;
      continue;
    }
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (esc) {
          esc = false;
          continue;
        }
        if (ch === "\\") {
          esc = true;
          continue;
        }
        if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') {
        inStr = true;
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    from = after;
  }
  return null;
}

function parseEmbedsMap(text: string): EmbedsMap | null {
  const candidates = [
    extractJsonObjectAfter(text, "finalizePlayer("),
    extractJsonObjectAfter(text, "const EMBEDS = "),
    extractJsonObjectAfter(text, "let EMBEDS = "),
    extractJsonObjectAfter(text, "var EMBEDS = "),
  ].filter(Boolean) as string[];

  for (const raw of candidates) {
    try {
      const data = JSON.parse(raw) as EmbedsMap;
      if (data && typeof data === "object" && !Array.isArray(data)) {
        const langs = Object.keys(data);
        if (langs.some((k) => data[k] && typeof data[k] === "object")) {
          return data;
        }
      }
    } catch {
      /* try next */
    }
  }
  return null;
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

  const referer = `${UNLIM}/`;
  const season = opts.season ?? 1;
  const episode = opts.episode ?? 1;
  const paths = [
    embedPagePath(opts),
    opts.type === "movie" ? `/f/embed/movie/${opts.tmdbId}` : `/f/embed/tv/${opts.tmdbId}/${season}/${episode}`,
  ];

  for (const path of paths) {
    try {
      const { text, status } = await fetchText(`${UNLIM}${path}`, referer);
      if (status >= 400) continue;
      const data = parseEmbedsMap(text);
      if (data) {
        cacheSet(key, data, 20 * 60 * 1000);
        return data;
      }
    } catch {
      /* next path */
    }
  }
  return null;
}

function extractM3u8(html: string): string | null {
  const hits = html.match(/https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*/g);
  if (!hits?.length) return null;
  // Preferir playlists que no parezcan ads/thumbnails
  const ranked = hits.sort((a, b) => scoreMediaUrl(b) - scoreMediaUrl(a));
  return ranked[0] ?? null;
}

function extractMp4(html: string): string | null {
  const hits = html.match(/https?:\/\/[^\s"'<>\\]+\.mp4[^\s"'<>\\]*/g);
  if (!hits?.length) return null;
  const filtered = hits.filter((u) => !u.includes("image.tmdb") && !/poster|thumb|preview/i.test(u));
  const ranked = (filtered.length ? filtered : hits).sort((a, b) => scoreMediaUrl(b) - scoreMediaUrl(a));
  return ranked[0] ?? null;
}

function scoreMediaUrl(url: string): number {
  let s = 0;
  if (/\.m3u8($|\?)/i.test(url)) s += 50;
  if (/\.mp4($|\?)/i.test(url)) s += 40;
  if (/master|index|playlist|hls/i.test(url)) s += 20;
  if (/1080|720|480/i.test(url)) s += 10;
  if (/ads?|preroll|banner|pixel|track/i.test(url)) s -= 80;
  return s;
}

/** Multi-señal: jwplayer sources, file:, hls:, JSON embebido. */
function extractJsMediaUrls(html: string): string[] {
  const out: string[] = [];
  const push = (u: string) => {
    if (!u.startsWith("http")) return;
    if (!/\.m3u8|\.mp4/i.test(u)) return;
    if (!out.includes(u)) out.push(u);
  };

  for (const re of [
    /["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/gi,
    /["'](https?:\/\/[^"']+\.mp4[^"']*)["']/gi,
    /file\s*[:=]\s*["'](https?:\/\/[^"']+)["']/gi,
    /sources?\s*[:=]\s*\[\s*\{\s*file\s*:\s*["'](https?:\/\/[^"']+)["']/gi,
    /src\s*:\s*["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/gi,
  ]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      if (m[1]) push(m[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/"));
    }
  }

  return out.sort((a, b) => scoreMediaUrl(b) - scoreMediaUrl(a));
}

function looksLikeAdPayload(text: string): boolean {
  const t = text.slice(0, 800).toLowerCase();
  if (t.includes("#extm3u") || t.includes("ftyp")) return false;
  if (t.includes("<!doctype html") || t.includes("<html")) return true;
  if (t.includes("cf-browser-verification") || t.includes("just a moment")) return true;
  return false;
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
  if (looksLikeAdPayload(text) && !extractM3u8(text) && !extractMp4(text)) {
    /* sigue intentando APIs */
  }

  const jsHits = extractJsMediaUrls(text);
  const inline = jsHits[0] ?? extractM3u8(text) ?? extractMp4(text);
  if (inline) return inline;

  const fileCode =
    finalUrl.match(/\/(?:e|v|embed|f)\/([a-zA-Z0-9]+)/i)?.[1] ??
    text.match(/file_code\s*=\s*["']([^"']+)/i)?.[1] ??
    text.match(/["']file_code["']\s*:\s*["']([^"']+)/i)?.[1];
  if (!fileCode) return null;

  const host = new URL(finalUrl).hostname;
  const apis = [
    `https://${host}/ajax/embed/get?id=${fileCode}`,
    `https://${host}/ajax/b/embed/get?id=${fileCode}`,
    `https://${host}/api/source/${fileCode}`,
    `https://${host}/mediainfo/${fileCode}`,
    `https://${host}/dl`,
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
        signal: AbortSignal.timeout(SPECTRE_TIMEOUT_MS),
      });
      const body = await res.text();
      if (looksLikeAdPayload(body)) continue;
      const fromJs = extractJsMediaUrls(body)[0];
      const fromText = fromJs ?? extractM3u8(body) ?? extractMp4(body);
      if (fromText) return fromText;
      try {
        const j = JSON.parse(body) as Record<string, unknown>;
        for (const k of ["file", "source", "url", "link", "hls", "src"]) {
          const v = j[k];
          if (typeof v === "string" && (v.includes(".m3u8") || v.includes(".mp4"))) return v;
        }
        const sources = j.sources;
        if (Array.isArray(sources)) {
          for (const s of sources) {
            if (s && typeof s === "object" && "file" in s && typeof (s as { file: string }).file === "string") {
              const f = (s as { file: string }).file;
              if (f.includes(".m3u8") || f.includes(".mp4")) return f;
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

/** Remux/UnlimPlay a menudo ignoran Range y mandan el archivo entero: leer pocos bytes y cancelar. */
async function readPrefixBytes(
  url: string,
  headers: Record<string, string>,
  maxBytes: number,
): Promise<{ status: number; buf: Buffer } | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 12000);
  try {
    const res = await fetch(url, {
      headers,
      redirect: "follow",
      signal: ac.signal,
    });
    if (!res.ok || !res.body) {
      return { status: res.status, buf: Buffer.alloc(0) };
    }
    const reader = res.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const need = maxBytes - total;
      chunks.push(Buffer.from(value.subarray(0, need)));
      total += Math.min(value.byteLength, need);
      if (total >= maxBytes) break;
    }
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
    // No abortar el AbortController aquí: puede emitir 'error' no manejado en undici.
    return { status: res.status, buf: Buffer.concat(chunks).subarray(0, maxBytes) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function isValidRemux(url: string): Promise<boolean> {
  const hit = await readPrefixBytes(
    url,
    {
      "User-Agent": UA,
      Referer: `${UNLIM}/`,
      Origin: UNLIM,
      Range: "bytes=0-2047",
      Accept: "*/*",
    },
    64,
  );
  if (!hit || hit.status >= 400 || hit.buf.length < 8) return false;
  return hit.buf.subarray(4, 8).toString("utf8") === "ftyp";
}

async function isReachablePlaylist(url: string, referer: string): Promise<boolean> {
  const hit = await readPrefixBytes(
    url,
    {
      "User-Agent": UA,
      Referer: referer,
      Origin: UNLIM,
      Accept: "*/*",
      Range: "bytes=0-2048",
    },
    256,
  );
  if (!hit || hit.status >= 400) return false;
  return hit.buf.toString("utf8").includes("#EXTM3U");
}

async function resolveHostStream(
  host: string,
  embedUrl: string,
  referer: string,
): Promise<{ streamUrl: string | null; kind: "hls" | "mp4" | "embed" }> {
  const unwrapNested = (raw: string): { streamUrl: string; kind: "hls" | "mp4" } | null => {
    try {
      const u = new URL(raw);
      const nested = u.searchParams.get("url");
      if (nested) {
        const deep = unwrapNested(nested);
        if (deep) return deep;
        if (/\.m3u8/i.test(nested)) return { streamUrl: nested, kind: "hls" };
        if (/\.mp4/i.test(nested)) return { streamUrl: nested, kind: "mp4" };
      }
    } catch {
      /* ignore */
    }
    if (/\.m3u8/i.test(raw)) return { streamUrl: raw, kind: "hls" };
    if (/\.mp4/i.test(raw)) return { streamUrl: raw, kind: "mp4" };
    return null;
  };

  if (host === "direct") {
    const unwrapped = unwrapNested(embedUrl);
    if (unwrapped?.kind === "hls") {
      if (await isReachablePlaylist(unwrapped.streamUrl, referer)) return unwrapped;
      return unwrapped;
    }
    if (unwrapped) return unwrapped;

    try {
      const { text, finalUrl } = await fetchText(embedUrl, referer);
      const fromHtml = extractM3u8(text) ?? extractMp4(text);
      if (fromHtml) {
        return {
          streamUrl: fromHtml,
          kind: fromHtml.includes(".m3u8") ? "hls" : "mp4",
        };
      }
      const again = unwrapNested(finalUrl);
      if (again) return again;
    } catch {
      /* fallthrough */
    }
    return { streamUrl: null, kind: "embed" };
  }

  if (host === "remux") {
    const unwrapped = unwrapNested(embedUrl);
    const candidate = unwrapped?.streamUrl || embedUrl;
    if (await isValidRemux(candidate)) {
      return { streamUrl: candidate, kind: "mp4" };
    }
    return { streamUrl: null, kind: "embed" };
  }

  if (host === "netu" || host === "netu2" || host === "netu 2" || /waaw\.to/i.test(embedUrl)) {
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
  if (/\.mp4($|\?)/i.test(url) || url.includes("remux.unlimplay.com")) {
    return isValidRemux(url);
  }
  return isReachablePlaylist(url, referer);
}

function proxyUrlFor(target: string, referer: string, req: Request): string {
  const base = `${req.protocol}://${req.get("host")}/rf/stream/proxy`;
  return `${base}?u=${b64urlEncode(target)}&r=${b64urlEncode(referer)}&nosubs=1`;
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
  // El navegador no puede reproducir m3u8 cross-origin de UnlimPlay: siempre proxy HLS.
  if (isHls) {
    return {
      mode: "hls-proxy",
      url: proxyUrlFor(streamUrl, referer, req),
      referer,
      host,
      lang,
      validated,
    };
  }
  return {
    mode: "mp4-proxy",
    url: proxyUrlFor(streamUrl, referer, req),
    referer,
    host,
    lang,
    validated,
  };
}

type SpectreCandidate = {
  host: string;
  embedUrl: string;
  lang: StreamLang;
  score: number;
};

type SpectreHit = {
  host: string;
  lang: StreamLang;
  streamUrl: string;
  kind: "hls" | "mp4";
};

function collectSpectreCandidates(
  embeds: EmbedsMap,
  preferredLang: StreamLang,
  hostIndex: number,
): SpectreCandidate[] {
  const langs = orderedLangs(preferredLang, embeds);
  const out: SpectreCandidate[] = [];
  const seen = new Set<string>();

  for (const lang of langs) {
    const track = embeds[lang] || pickTrack(embeds, lang);
    if (!track) continue;

    const ordered = HOST_PRIORITY.filter((h) => track[h]).map((h) => [h, track[h]] as const);
    const extras = Object.entries(track).filter(
      ([h]) => h !== "searched_names" && !HOST_PRIORITY.includes(h as (typeof HOST_PRIORITY)[number]),
    );
    for (const [host, embedUrl] of [...ordered, ...extras]) {
      if (typeof embedUrl !== "string" || !embedUrl.startsWith("http")) continue;
      if (isIframeOnlyHost(host)) continue;
      const key = `${lang}|${host}|${embedUrl}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ host, embedUrl, lang, score: spectreScore(host) });
    }
  }

  out.sort((a, b) => b.score - a.score);
  // hostIndex: rotar ventana (cliente pide siguiente fuente limpia)
  if (hostIndex > 0 && hostIndex < out.length) {
    return [...out.slice(hostIndex), ...out.slice(0, hostIndex)];
  }
  return out;
}

async function spectreTryOne(
  candidate: SpectreCandidate,
  referer: string,
  signal: AbortSignal,
): Promise<SpectreHit | null> {
  if (signal.aborted) return null;
  try {
    const { streamUrl, kind } = await Promise.race([
      resolveHostStream(candidate.host, candidate.embedUrl, referer),
      new Promise<{ streamUrl: null; kind: "embed" }>((resolve) => {
        const t = setTimeout(() => resolve({ streamUrl: null, kind: "embed" }), SPECTRE_TIMEOUT_MS);
        signal.addEventListener("abort", () => {
          clearTimeout(t);
          resolve({ streamUrl: null, kind: "embed" });
        });
      }),
    ]);
    if (signal.aborted || !streamUrl || (kind !== "hls" && kind !== "mp4")) return null;

    const ok =
      kind === "hls"
        ? await isReachablePlaylist(streamUrl, referer)
        : await validateStream(streamUrl, referer);
    // HLS a veces falla el probe por CDN pero igual reproduce vía proxy
    if (!ok && kind === "mp4") return null;
    if (!ok && kind === "hls") {
      return { host: candidate.host, lang: candidate.lang, streamUrl, kind };
    }
    return { host: candidate.host, lang: candidate.lang, streamUrl, kind };
  } catch {
    return null;
  }
}

/** Carrera paralela: gana el primer m3u8/mp4 validado. */
async function spectreRace(
  candidates: SpectreCandidate[],
  referer: string,
): Promise<SpectreHit | null> {
  const batch = candidates.slice(0, SPECTRE_RACE_SIZE);
  if (!batch.length) return null;

  const ac = new AbortController();
  const pending = batch.map((c) => spectreTryOne(c, referer, ac.signal));

  return new Promise((resolve) => {
    let remaining = pending.length;
    let settled = false;
    for (const p of pending) {
      void p.then((hit) => {
        if (settled) return;
        if (hit) {
          settled = true;
          ac.abort();
          resolve(hit);
          return;
        }
        remaining -= 1;
        if (remaining <= 0) {
          settled = true;
          resolve(null);
        }
      });
    }
  });
}

/**
 * Spectre Direct-or-Nothing:
 * - Race paralelo de hosts extractables
 * - Multi-idioma
 * - Nunca retorna iframe/embed (sin ads de player)
 */
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
): Promise<(ResolvedStream & { algorithm: "spectre" }) | null> {
  const embeds = await fetchUnlimEmbeds(opts);
  if (!embeds) return null;

  const referer = embedReferer(opts);
  const idx = Math.max(0, opts.hostIndex ?? 0);
  const candidates = collectSpectreCandidates(embeds, opts.lang, idx);
  if (!candidates.length) return null;

  // Atajo nativo: direct/remux al inicio de la lista
  for (const c of candidates.slice(0, 4)) {
    if (c.host !== "direct" && c.host !== "remux") continue;
    const hit = await spectreTryOne(c, referer, new AbortController().signal);
    if (hit) {
      noteHostWin(hit.host);
      return {
        ...packResolved(hit.streamUrl, hit.kind, referer, hit.host, hit.lang, true, req),
        algorithm: "spectre",
      };
    }
  }

  const raced = await spectreRace(
    candidates.filter((c) => c.host !== "direct" && c.host !== "remux"),
    referer,
  );
  if (raced) {
    noteHostWin(raced.host);
    return {
      ...packResolved(raced.streamUrl, raced.kind, referer, raced.host, raced.lang, true, req),
      algorithm: "spectre",
    };
  }

  // Segunda pasada: candidatos restantes fuera del race window
  for (const c of candidates.slice(SPECTRE_RACE_SIZE)) {
    const hit = await spectreTryOne(c, referer, new AbortController().signal);
    if (hit) {
      noteHostWin(hit.host);
      return {
        ...packResolved(hit.streamUrl, hit.kind, referer, hit.host, hit.lang, true, req),
        algorithm: "spectre",
      };
    }
  }

  // Remux TMDB directo (movies)
  if (opts.type !== "tv") {
    const candidate = `https://remux.unlimplay.com/remux?id=${opts.tmdbId}`;
    if (await isValidRemux(candidate)) {
      noteHostWin("remux");
      return {
        ...packResolved(candidate, "mp4", `${UNLIM}/`, "remux", opts.lang, true, req),
        algorithm: "spectre",
      };
    }
  }

  return null;
}

function rewriteM3u8(body: string, targetUrl: string, referer: string, req: Request, stripSubs: boolean): string {
  const base = new URL(targetUrl);
  const normalized = stripSubs ? stripSubtitleRenditions(body) : body;
  return normalized
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
        res.setHeader("Cache-Control", "public, max-age=60");
        res.json({
          ok: false,
          algorithm: "spectre",
          lang,
          langs: [lang],
          hosts: [],
          extractableHosts: [],
          error: "spectre_no_sources",
        });
        return;
      }
      const track = pickTrack(embeds, lang) ?? embeds.latino ?? {};
      const ordered = HOST_PRIORITY.filter((h) => track[h] && !isIframeOnlyHost(h));
      const extras = Object.keys(track).filter(
        (k) =>
          k !== "searched_names" &&
          !HOST_PRIORITY.includes(k as (typeof HOST_PRIORITY)[number]) &&
          !isIframeOnlyHost(k),
      );
      const iframeHosts = Object.keys(track).filter(
        (k) => k !== "searched_names" && isIframeOnlyHost(k) && track[k],
      );
      // Spectre: hosts extractables primero; iframe-only al final (cliente no debería usarlos)
      const hosts = [...ordered, ...extras, ...iframeHosts];
      res.setHeader("Cache-Control", "public, max-age=300");
      res.json({
        ok: true,
        algorithm: "spectre",
        lang,
        langs: Object.keys(embeds).filter((k) => k !== "searched_names"),
        hosts,
        extractableHosts: [...ordered, ...extras],
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
        res.status(404).json({
          ok: false,
          algorithm: "spectre",
          error: "spectre_no_direct_stream",
          message: "Sin m3u8/mp4 limpio (Direct-or-Nothing: no embed/ads)",
        });
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

    const ac = new AbortController();
    const onClose = () => ac.abort();
    req.on("close", onClose);

    try {
      const upstream = await fetch(u, {
        headers: {
          "User-Agent": UA,
          Referer: r,
          Accept: "*/*",
          Origin: new URL(r).origin,
        },
        redirect: "follow",
        signal: ac.signal,
      });

      if (!upstream.ok) {
        res.status(upstream.status).send(`upstream ${upstream.status}`);
        return;
      }

      const ct = upstream.headers.get("content-type") || "";
      const looksPlaylist =
        ct.includes("mpegurl") || ct.includes("m3u8") || /\.m3u8($|\?)/i.test(u);

      // Solo bufferizar playlists (pequeñas). Media binaria: pipe streaming.
      if (looksPlaylist) {
        const text = await upstream.text();
        if (text.length > 2_000_000) {
          res.status(502).send("playlist too large");
          return;
        }
        if (text.includes("#EXTM3U") || text.includes("#EXT-X-")) {
          const rewritten = rewriteM3u8(text, u, r, req, req.query.nosubs !== "0");
          res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Cache-Control", "no-cache");
          res.send(rewritten);
          return;
        }
      }

      res.setHeader("Content-Type", ct || "application/octet-stream");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "public, max-age=3600");
      if (!upstream.body) {
        res.status(502).send("empty upstream");
        return;
      }

      const { Readable } = await import("node:stream");
      const nodeStream = Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream);
      // Sin esto, un "other side closed" del upstream tumba todo el proceso (exit 1).
      nodeStream.on("error", () => {
        if (!res.headersSent) res.status(502).end("upstream closed");
        else res.destroy();
      });
      res.on("error", () => {
        nodeStream.destroy();
      });
      nodeStream.pipe(res);
    } catch (e) {
      if (ac.signal.aborted) return;
      if (!res.headersSent) {
        res.status(502).send(e instanceof Error ? e.message : "proxy error");
      }
    } finally {
      req.off("close", onClose);
    }
  });
}
