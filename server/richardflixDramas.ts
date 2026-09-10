/**
 * RichardFlix Dramas — short dramas (DramaBox) vía @zhadev/dramabox.
 * Rutas bajo /rf/dramas/*
 */
import type { Request, Response, Router } from "express";
import DramaboxClient from "@zhadev/dramabox";

type CacheEntry = { body: unknown; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const CACHE_MAX = 80;

type DramaCard = {
  id: string;
  title: string;
  cover: string;
  introduction: string;
};

type DramaEpisode = {
  index: number;
  episode: number;
  chapterId: string;
  name: string;
  quality?: number;
  url?: string;
};

type VideoPath = {
  quality?: number;
  videoPath?: string;
  isDefault?: number;
  isVipEquity?: number;
};

type CdnEntry = {
  isDefault?: number;
  videoPathList?: VideoPath[];
};

type ChapterRaw = {
  chapterId?: string | number;
  chapterIndex?: number;
  chapterName?: string;
  cdnList?: CdnEntry[];
  videoPath?: string;
};

type BatchEpisodeRaw = {
  chapterId?: string | number;
  chapterIndex?: number;
  chapterName?: string;
  videoPath?: string;
};

let client: InstanceType<typeof DramaboxClient> | null = null;

function getClient(): InstanceType<typeof DramaboxClient> {
  if (!client) {
    client = new DramaboxClient({
      language: "es",
      version: "470",
      // batchDownload puede tardar 15–40s al resolver varios capítulos
      timeout: 90000,
      requestDelay: 250,
      maxRetries: 2,
    });
  }
  return client;
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

function pickCover(raw: Record<string, unknown>): string {
  const keys = ["coverWap", "cover", "bookCover", "coverPath", "picUrl"];
  for (const k of keys) {
    const v = raw[k];
    if (typeof v === "string" && v.startsWith("http")) return v;
  }
  return "";
}

function pickTitle(raw: Record<string, unknown>): string {
  const keys = ["bookName", "name", "title", "bookTitle"];
  for (const k of keys) {
    const v = raw[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "Drama";
}

function pickId(raw: Record<string, unknown>): string {
  const keys = ["bookId", "id", "book_id"];
  for (const k of keys) {
    const v = raw[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return "";
}

function normalizeCard(raw: unknown): DramaCard | null {
  const r = asRecord(raw);
  if (!r) return null;
  const id = pickId(r);
  if (!id) return null;
  return {
    id,
    title: pickTitle(r),
    cover: pickCover(r),
    introduction: typeof r.introduction === "string" ? r.introduction : "",
  };
}

function normalizeList(raw: unknown): DramaCard[] {
  if (Array.isArray(raw)) {
    return raw.map(normalizeCard).filter((x): x is DramaCard => Boolean(x));
  }
  const r = asRecord(raw);
  if (!r) return [];
  for (const key of ["results", "items", "book", "list", "books"]) {
    if (Array.isArray(r[key])) {
      return (r[key] as unknown[]).map(normalizeCard).filter((x): x is DramaCard => Boolean(x));
    }
  }
  return [];
}

function pickBestVideo(chapter: ChapterRaw): { url: string; quality: number } | null {
  const cdns = Array.isArray(chapter.cdnList) ? chapter.cdnList : [];
  const ordered = [...cdns].sort((a, b) => (b.isDefault === 1 ? 1 : 0) - (a.isDefault === 1 ? 1 : 0));
  for (const cdn of ordered) {
    const paths = Array.isArray(cdn.videoPathList) ? cdn.videoPathList : [];
    const free = paths
      .filter((p) => p && typeof p.videoPath === "string" && p.videoPath.startsWith("http") && !p.isVipEquity)
      .sort((a, b) => (b.quality || 0) - (a.quality || 0));
    const best = free[0] || paths.find((p) => p?.isDefault === 1 && p.videoPath) || paths.find((p) => p?.videoPath);
    if (best?.videoPath) {
      return { url: best.videoPath, quality: Number(best.quality) || 0 };
    }
  }
  return null;
}

function normalizeEpisodes(chapters: ChapterRaw[]): DramaEpisode[] {
  return chapters
    .map((ch, i) => {
      const index = typeof ch.chapterIndex === "number" ? ch.chapterIndex : i;
      const fromCdn = pickBestVideo(ch);
      const direct =
        typeof ch.videoPath === "string" && ch.videoPath.startsWith("http")
          ? { url: ch.videoPath, quality: 720 }
          : null;
      const video = fromCdn || direct;
      return {
        index,
        episode: index + 1,
        chapterId: String(ch.chapterId ?? ""),
        name: (ch.chapterName || `Episodio ${index + 1}`).trim(),
        quality: video?.quality,
        url: video?.url,
      };
    })
    .sort((a, b) => a.index - b.index);
}

function normalizeBatchEpisodes(raw: unknown): DramaEpisode[] {
  if (!Array.isArray(raw)) return [];
  return (raw as BatchEpisodeRaw[])
    .map((ep, i) => {
      const index = typeof ep.chapterIndex === "number" ? ep.chapterIndex : i;
      const url =
        typeof ep.videoPath === "string" && ep.videoPath.startsWith("http")
          ? ep.videoPath
          : undefined;
      return {
        index,
        episode: index + 1,
        chapterId: String(ep.chapterId ?? ""),
        name: (ep.chapterName || `Episodio ${index + 1}`).trim(),
        quality: url ? 720 : undefined,
        url,
      };
    })
    .filter((ep) => Boolean(ep.url))
    .sort((a, b) => a.index - b.index);
}

async function loadHomepage(): Promise<{
  latest: DramaCard[];
  trending: DramaCard[];
  recommended: DramaCard[];
}> {
  const key = "dramas:home:es";
  const hit = cacheGet<{ latest: DramaCard[]; trending: DramaCard[]; recommended: DramaCard[] }>(key);
  if (hit) return hit;

  const res = await getClient().getHomepage();
  const data = asRecord(res?.data) || {};
  const body = {
    latest: normalizeList(data.latest),
    trending: normalizeList(data.trending),
    recommended: normalizeList(data.recommended),
  };
  cacheSet(key, body, 5 * 60 * 1000);
  return body;
}

async function loadChaptersFromList(bookId: string): Promise<{
  bookId: string;
  totalChapters: number;
  episodes: DramaEpisode[];
  source: "chapters";
}> {
  const res = await getClient().getChapters(bookId);
  const data = asRecord(res?.data) || {};
  const chapters = Array.isArray(data.chapters) ? (data.chapters as ChapterRaw[]) : [];
  const episodes = normalizeEpisodes(chapters);
  return {
    bookId: String(data.bookId || bookId),
    totalChapters: Number(data.totalChapters) || episodes.length,
    episodes,
    source: "chapters",
  };
}

/** Prefer batchDownload: desbloquea más episodios que el free tier de getChapters (~6). */
async function loadChapters(bookId: string): Promise<{
  bookId: string;
  totalChapters: number;
  seriesTotal: number;
  episodes: DramaEpisode[];
  source: "batch" | "chapters";
}> {
  const key = `dramas:batch:${bookId}`;
  const hit = cacheGet<{
    bookId: string;
    totalChapters: number;
    seriesTotal: number;
    episodes: DramaEpisode[];
    source: "batch" | "chapters";
  }>(key);
  if (hit) return hit;

  const [listSettled, batchSettled] = await Promise.allSettled([
    loadChaptersFromList(bookId),
    getClient().batchDownload(bookId),
  ]);

  const list =
    listSettled.status === "fulfilled"
      ? listSettled.value
      : null;
  const seriesTotalHint = list?.totalChapters || list?.episodes.length || 0;

  if (batchSettled.status === "fulfilled") {
    const data = asRecord(batchSettled.value?.data) || {};
    const episodes = normalizeBatchEpisodes(data.episodes);
    if (episodes.length > 0) {
      const body = {
        bookId: String(data.bookId || bookId),
        totalChapters: episodes.length,
        seriesTotal: Math.max(seriesTotalHint, Number(data.totalEpisodes) || 0, episodes.length),
        episodes,
        source: "batch" as const,
      };
      cacheSet(key, body, 20 * 60 * 1000);
      return body;
    }
  }

  if (list && list.episodes.length > 0) {
    const body = {
      bookId: list.bookId,
      totalChapters: list.episodes.length,
      seriesTotal: Math.max(seriesTotalHint, list.totalChapters, list.episodes.length),
      episodes: list.episodes,
      source: "chapters" as const,
    };
    cacheSet(key, body, 10 * 60 * 1000);
    return body;
  }

  throw new Error(
    batchSettled.status === "rejected"
      ? batchSettled.reason instanceof Error
        ? batchSettled.reason.message
        : "batchDownload falló"
      : "Sin episodios disponibles",
  );
}

async function resolveStreamUrl(bookId: string, episode: number): Promise<{
  url: string;
  quality: number;
  source: "batch" | "chapters" | "stream";
  allEps: number;
  seriesTotal: number;
}> {
  const chapters = await loadChapters(bookId);
  const ep = chapters.episodes.find((e) => e.episode === episode) || chapters.episodes[episode - 1];
  if (ep?.url) {
    return {
      url: ep.url,
      quality: ep.quality || 0,
      source: chapters.source,
      allEps: chapters.totalChapters,
      seriesTotal: chapters.seriesTotal,
    };
  }

  // Fallback: API de stream (índice 0-based en el cliente npm)
  const streamRes = await getClient().getStreamUrl(bookId, Math.max(0, episode - 1));
  const outer = asRecord(streamRes?.data);
  const inner = asRecord(outer?.data) || outer;
  const chapter = asRecord(inner?.chapter);
  const video = asRecord(chapter?.video);
  const mp4 = typeof video?.mp4 === "string" ? video.mp4 : "";
  const m3u8 = typeof video?.m3u8 === "string" ? video.m3u8 : "";
  const url = mp4 || m3u8;
  if (!url) {
    throw new Error("Sin URL de reproducción para este episodio");
  }
  return {
    url,
    quality: 0,
    source: "stream",
    allEps: Number(inner?.allEps) || chapters.totalChapters,
    seriesTotal: chapters.seriesTotal,
  };
}

function findCardMeta(id: string, pools: DramaCard[][]): DramaCard | null {
  for (const pool of pools) {
    const hit = pool.find((d) => d.id === id);
    if (hit) return hit;
  }
  return null;
}

export function mountRichardflixDramas(router: Router): void {
  router.get("/dramas/home", async (_req: Request, res: Response) => {
    try {
      const home = await loadHomepage();
      res.setHeader("Cache-Control", "public, max-age=120");
      res.json({ success: true, language: "es", ...home });
    } catch (e) {
      res.status(502).json({
        success: false,
        error: e instanceof Error ? e.message : "dramas home error",
      });
    }
  });

  router.get("/dramas/trending", async (_req: Request, res: Response) => {
    try {
      const key = "dramas:trending:es";
      let items = cacheGet<DramaCard[]>(key);
      if (!items) {
        const r = await getClient().getTrending();
        items = normalizeList(r?.data);
        cacheSet(key, items, 5 * 60 * 1000);
      }
      res.setHeader("Cache-Control", "public, max-age=120");
      res.json({ success: true, total: items.length, items });
    } catch (e) {
      res.status(502).json({
        success: false,
        error: e instanceof Error ? e.message : "dramas trending error",
      });
    }
  });

  router.get("/dramas/for-you", async (_req: Request, res: Response) => {
    try {
      const key = "dramas:foryou:es";
      let items = cacheGet<DramaCard[]>(key);
      if (!items) {
        const r = await getClient().getForYou();
        items = normalizeList(r?.data);
        cacheSet(key, items, 5 * 60 * 1000);
      }
      res.setHeader("Cache-Control", "public, max-age=120");
      res.json({ success: true, total: items.length, items });
    } catch (e) {
      res.status(502).json({
        success: false,
        error: e instanceof Error ? e.message : "dramas for-you error",
      });
    }
  });

  router.get("/dramas/search", async (req: Request, res: Response) => {
    const q = String(req.query.q || "").trim();
    if (!q) {
      res.status(400).json({ success: false, error: "q requerido" });
      return;
    }
    try {
      const key = `dramas:search:${q.toLowerCase()}`;
      let items = cacheGet<DramaCard[]>(key);
      if (!items) {
        const r = await getClient().searchDrama(q);
        items = normalizeList(r?.data);
        cacheSet(key, items, 3 * 60 * 1000);
      }
      res.setHeader("Cache-Control", "public, max-age=60");
      res.json({ success: true, q, total: items.length, items });
    } catch (e) {
      res.status(502).json({
        success: false,
        error: e instanceof Error ? e.message : "dramas search error",
      });
    }
  });

  router.get("/dramas/:id/episodes", async (req: Request, res: Response) => {
    const id = String(req.params.id || "").trim();
    if (!id) {
      res.status(400).json({ success: false, error: "id requerido" });
      return;
    }
    try {
      const data = await loadChapters(id);
      res.setHeader("Cache-Control", "public, max-age=180");
      res.json({
        success: true,
        bookId: data.bookId,
        total: data.totalChapters,
        seriesTotal: data.seriesTotal,
        source: data.source,
        episodes: data.episodes.map(({ url: _u, ...rest }) => rest),
      });
    } catch (e) {
      res.status(502).json({
        success: false,
        error: e instanceof Error ? e.message : "dramas episodes error",
      });
    }
  });

  router.get("/dramas/:id/stream", async (req: Request, res: Response) => {
    const id = String(req.params.id || "").trim();
    const episode = Math.max(1, Number(req.query.ep) || 1);
    if (!id) {
      res.status(400).json({ success: false, error: "id requerido" });
      return;
    }
    try {
      const stream = await resolveStreamUrl(id, episode);
      res.setHeader("Cache-Control", "public, max-age=60");
      res.json({
        success: true,
        bookId: id,
        episode,
        allEps: stream.allEps,
        seriesTotal: stream.seriesTotal,
        quality: stream.quality,
        source: stream.source,
        type: stream.url.includes(".m3u8") ? "hls" : "mp4",
        url: stream.url,
      });
    } catch (e) {
      res.status(502).json({
        success: false,
        error: e instanceof Error ? e.message : "dramas stream error",
      });
    }
  });

  router.get("/dramas/:id", async (req: Request, res: Response) => {
    const id = String(req.params.id || "").trim();
    if (!id) {
      res.status(400).json({ success: false, error: "id requerido" });
      return;
    }
    try {
      const [chapters, home] = await Promise.all([loadChapters(id), loadHomepage()]);
      let meta = findCardMeta(id, [home.trending, home.latest, home.recommended]);
      if (!meta) {
        try {
          const search = await getClient().searchDrama(id);
          meta = normalizeList(search?.data).find((d) => d.id === id) || null;
        } catch {
          /* ignore */
        }
      }
      res.setHeader("Cache-Control", "public, max-age=120");
      res.json({
        success: true,
        drama: {
          id,
          title: meta?.title || `Drama ${id}`,
          cover: meta?.cover || "",
          introduction: meta?.introduction || "",
          totalEpisodes: chapters.totalChapters,
          seriesTotal: chapters.seriesTotal,
          source: chapters.source,
          episodes: chapters.episodes.map(({ url: _u, ...rest }) => rest),
        },
      });
    } catch (e) {
      res.status(502).json({
        success: false,
        error: e instanceof Error ? e.message : "dramas detail error",
      });
    }
  });
}
