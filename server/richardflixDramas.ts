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
  locked?: boolean;
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

const BATCH_LOAD = "/drama-box/chapterv2/batch/load";
const CHAPTER_DETAIL = "/drama-box/chapterv2/detail";

function pickFreeFromChapter(ch: ChapterRaw): { url: string; quality: number } | null {
  const fromCdn = pickBestVideo(ch);
  if (fromCdn) return fromCdn;
  if (typeof ch.videoPath === "string" && ch.videoPath.startsWith("http")) {
    return { url: ch.videoPath, quality: 720 };
  }
  return null;
}

function isValidWindow(indexes: number[], requestedIndex: number): boolean {
  if (!indexes.length) return false;
  // Cuando el muro VIP cae, DramaBox devuelve basura tipo [0,1] aunque pedimos index>=21
  if (requestedIndex > 6 && indexes[0] === 0 && indexes.length <= 2) return false;
  return true;
}

/** Catálogo completo (52…) sin URLs — endpoint detail. */
async function loadFullCatalog(bookId: string): Promise<{
  episodes: DramaEpisode[];
  seriesTotal: number;
}> {
  const client = getClient();
  let seedChapterId = "";
  try {
    const seed = await client.getChapters(bookId);
    const first = (asRecord(seed?.data)?.chapters as ChapterRaw[] | undefined)?.[0];
    seedChapterId = first?.chapterId != null ? String(first.chapterId) : "";
  } catch {
    /* ignore */
  }

  const payload: Record<string, unknown> = {
    needRecommend: false,
    from: "player",
    bookId,
  };
  if (seedChapterId) payload.chapterId = seedChapterId;

  const data = await client.sapiRequest(CHAPTER_DETAIL, payload);
  const rawList = (asRecord(data)?.data as { list?: unknown } | undefined)?.list;
  const list = Array.isArray(rawList) ? (rawList as ChapterRaw[]) : [];

  const episodes = list
    .map((ch, i) => {
      const index = typeof ch.chapterIndex === "number" ? ch.chapterIndex : i;
      return {
        index,
        episode: index + 1,
        chapterId: String(ch.chapterId ?? ""),
        name: (ch.chapterName || `Episodio ${index + 1}`).trim(),
        locked: true,
      } satisfies DramaEpisode;
    })
    .sort((a, b) => a.index - b.index);

  return { episodes, seriesTotal: episodes.length };
}

/** Ventana deslizante batch/load — desbloquea ~20 gratis aunque isCharge=1. */
async function deepUnlockUrls(
  bookId: string,
  opts?: { aggressive?: boolean },
): Promise<Map<number, { url: string; quality: number; chapterId?: string; name?: string }>> {
  const client = getClient();
  const found = new Map<number, { url: string; quality: number; chapterId?: string; name?: string }>();
  let seriesTotal = 0;

  const indexes: number[] = [1];
  const step = opts?.aggressive ? 3 : 5;
  for (let i = 1 + step; i <= 80; i += step) indexes.push(i);
  if (opts?.aggressive) {
    for (let i = 2; i <= 30; i++) {
      if (!indexes.includes(i)) indexes.push(i);
    }
    indexes.sort((a, b) => a - b);
  }

  for (const index of indexes) {
    if (seriesTotal && index > seriesTotal + 1) break;
    try {
      const data = await client.sapiRequest(BATCH_LOAD, {
        boundaryIndex: 0,
        comingPlaySectionId: -1,
        index,
        currencyPlaySourceName: "首页发现_Untukmu_推荐列表",
        rid: "",
        enterReaderChapterIndex: Math.max(0, index - 1),
        loadDirection: 1,
        startUpKey: "10942710-5e9e-48f2-8927-7c387e6f5fac",
        bookId,
        currencyPlaySource: "discover_175_rec",
        needEndRecommend: 0,
        preLoad: false,
        pullCid: "",
      });
      const body = asRecord(asRecord(data)?.data) || {};
      seriesTotal = Number(body.chapterCount) || seriesTotal;
      const list = Array.isArray(body.chapterList) ? (body.chapterList as ChapterRaw[]) : [];
      const idxs = list.map((c) => (typeof c.chapterIndex === "number" ? c.chapterIndex : -1));
      if (!isValidWindow(idxs, index)) break;

      for (const ch of list) {
        const video = pickFreeFromChapter(ch);
        if (!video) continue;
        const idx = typeof ch.chapterIndex === "number" ? ch.chapterIndex : -1;
        if (idx < 0 || found.has(idx)) continue;
        found.set(idx, {
          url: video.url,
          quality: video.quality,
          chapterId: ch.chapterId != null ? String(ch.chapterId) : undefined,
          name: ch.chapterName,
        });
      }
    } catch {
      break;
    }
  }

  return found;
}

function mergeCatalogWithUrls(
  catalog: DramaEpisode[],
  urls: Map<number, { url: string; quality: number; chapterId?: string; name?: string }>,
  seriesTotalHint: number,
): DramaEpisode[] {
  const byIndex = new Map<number, DramaEpisode>();
  for (const ep of catalog) byIndex.set(ep.index, { ...ep });

  for (const [index, video] of urls) {
    const prev = byIndex.get(index);
    byIndex.set(index, {
      index,
      episode: index + 1,
      chapterId: video.chapterId || prev?.chapterId || "",
      name: video.name || prev?.name || `Episodio ${index + 1}`,
      quality: video.quality,
      url: video.url,
      locked: false,
    });
  }

  // Rellenar huecos 0..seriesTotal-1 si el catálogo vino corto
  const knownMax = byIndex.size ? Math.max(...byIndex.keys()) : -1;
  const maxIndex = Math.max(seriesTotalHint - 1, knownMax, -1);
  for (let i = 0; i <= maxIndex; i++) {
    if (!byIndex.has(i)) {
      byIndex.set(i, {
        index: i,
        episode: i + 1,
        chapterId: "",
        name: `Episodio ${i + 1}`,
        locked: true,
      });
    } else if (!byIndex.get(i)?.url) {
      byIndex.set(i, { ...byIndex.get(i)!, locked: true });
    }
  }

  return [...byIndex.values()].sort((a, b) => a.index - b.index);
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
  const episodes = normalizeEpisodes(chapters).map((ep) => ({
    ...ep,
    locked: !ep.url,
  }));
  return {
    bookId: String(data.bookId || bookId),
    totalChapters: Number(data.totalChapters) || episodes.length,
    episodes,
    source: "chapters",
  };
}

type LoadedChapters = {
  bookId: string;
  totalChapters: number;
  available: number;
  seriesTotal: number;
  episodes: DramaEpisode[];
  source: "deep" | "batch" | "chapters";
};

/** Catálogo completo + URLs desbloqueables (deep crawl / batch). */
async function loadChapters(bookId: string, opts?: { force?: boolean; aggressive?: boolean }): Promise<LoadedChapters> {
  const key = `dramas:full:${bookId}`;
  if (!opts?.force) {
    const hit = cacheGet<LoadedChapters>(key);
    if (hit) return hit;
  }

  const [catalogSettled, unlockSettled, batchSettled] = await Promise.allSettled([
    loadFullCatalog(bookId),
    deepUnlockUrls(bookId, { aggressive: opts?.aggressive }),
    getClient().batchDownload(bookId),
  ]);

  const catalog =
    catalogSettled.status === "fulfilled"
      ? catalogSettled.value
      : { episodes: [] as DramaEpisode[], seriesTotal: 0 };

  const urlMap = new Map<number, { url: string; quality: number; chapterId?: string; name?: string }>();

  if (unlockSettled.status === "fulfilled") {
    for (const [k, v] of unlockSettled.value) urlMap.set(k, v);
  }

  if (batchSettled.status === "fulfilled") {
    const data = asRecord(batchSettled.value?.data) || {};
    for (const ep of normalizeBatchEpisodes(data.episodes)) {
      if (!ep.url || urlMap.has(ep.index)) continue;
      urlMap.set(ep.index, {
        url: ep.url,
        quality: ep.quality || 720,
        chapterId: ep.chapterId,
        name: ep.name,
      });
    }
  }

  let episodes = mergeCatalogWithUrls(catalog.episodes, urlMap, catalog.seriesTotal);
  let seriesTotal = Math.max(catalog.seriesTotal, episodes.length);
  let source: LoadedChapters["source"] = urlMap.size ? "deep" : "chapters";

  if (episodes.length === 0) {
    const fallback = await loadChaptersFromList(bookId);
    episodes = fallback.episodes;
    seriesTotal = Math.max(fallback.totalChapters, episodes.length);
    source = "chapters";
  }

  const available = episodes.filter((e) => e.url && !e.locked).length;
  const body: LoadedChapters = {
    bookId,
    totalChapters: available,
    available,
    seriesTotal,
    episodes,
    source,
  };
  cacheSet(key, body, 20 * 60 * 1000);
  return body;
}

async function resolveStreamUrl(bookId: string, episode: number): Promise<{
  url: string;
  quality: number;
  source: "deep" | "batch" | "chapters" | "stream" | "ondemand";
  allEps: number;
  seriesTotal: number;
  locked?: boolean;
}> {
  const chapters = await loadChapters(bookId);
  const ep = chapters.episodes.find((e) => e.episode === episode);
  if (ep?.url) {
    return {
      url: ep.url,
      quality: ep.quality || 0,
      source: chapters.source,
      allEps: chapters.available,
      seriesTotal: chapters.seriesTotal,
    };
  }

  // On-demand: una ventana batch centrada en ese episodio
  try {
    const data = await getClient().sapiRequest(BATCH_LOAD, {
      boundaryIndex: 0,
      comingPlaySectionId: -1,
      index: episode,
      currencyPlaySourceName: "首页发现_Untukmu_推荐列表",
      rid: "",
      enterReaderChapterIndex: Math.max(0, episode - 1),
      loadDirection: 1,
      startUpKey: "10942710-5e9e-48f2-8927-7c387e6f5fac",
      bookId,
      currencyPlaySource: "discover_175_rec",
      needEndRecommend: 0,
      preLoad: false,
      pullCid: ep?.chapterId || "",
    });
    const body = asRecord(asRecord(data)?.data) || {};
    const list = Array.isArray(body.chapterList) ? (body.chapterList as ChapterRaw[]) : [];
    const idxs = list.map((c) => (typeof c.chapterIndex === "number" ? c.chapterIndex : -1));
    if (isValidWindow(idxs, episode)) {
      const hit = list.find((c) => c.chapterIndex === episode - 1);
      const video = hit ? pickFreeFromChapter(hit) : null;
      if (video) {
        // refrescar caché con este capítulo
        const key = `dramas:full:${bookId}`;
        const cached = cacheGet<LoadedChapters>(key);
        if (cached) {
          const next = cached.episodes.map((e) =>
            e.episode === episode
              ? { ...e, url: video.url, quality: video.quality, locked: false }
              : e,
          );
          const available = next.filter((e) => e.url && !e.locked).length;
          cacheSet(key, { ...cached, episodes: next, available, totalChapters: available }, 20 * 60 * 1000);
        }
        return {
          url: video.url,
          quality: video.quality,
          source: "ondemand",
          allEps: chapters.available + 1,
          seriesTotal: chapters.seriesTotal,
        };
      }
    }
  } catch {
    /* ignore */
  }

  if (ep?.locked) {
    const err = new Error("Episodio bloqueado por DramaBox (requiere VIP)");
    (err as Error & { code?: string }).code = "LOCKED";
    throw err;
  }

  throw new Error("Sin URL de reproducción para este episodio");
}

function cacheDelete(key: string): void {
  cache.delete(key);
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
        total: data.available,
        available: data.available,
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

  router.post("/dramas/:id/expand", async (req: Request, res: Response) => {
    const id = String(req.params.id || "").trim();
    if (!id) {
      res.status(400).json({ success: false, error: "id requerido" });
      return;
    }
    try {
      cacheDelete(`dramas:full:${id}`);
      const before = await loadChapters(id, { force: true, aggressive: true });
      res.json({
        success: true,
        bookId: id,
        available: before.available,
        seriesTotal: before.seriesTotal,
        source: before.source,
        gained: before.available,
        episodes: before.episodes.map(({ url: _u, ...rest }) => rest),
        message:
          before.available >= before.seriesTotal
            ? "Todos los episodios disponibles están desbloqueados."
            : `Se desbloquearon ${before.available} de ${before.seriesTotal}. El resto sigue en VIP de DramaBox.`,
      });
    } catch (e) {
      res.status(502).json({
        success: false,
        error: e instanceof Error ? e.message : "dramas expand error",
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
      const msg = e instanceof Error ? e.message : "dramas stream error";
      const locked = (e as Error & { code?: string })?.code === "LOCKED" || /bloqueado/i.test(msg);
      res.status(locked ? 423 : 502).json({
        success: false,
        locked,
        error: msg,
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
          totalEpisodes: chapters.available,
          available: chapters.available,
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
