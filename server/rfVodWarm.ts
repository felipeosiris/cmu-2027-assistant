/**
 * Precalentado de la caché VOD: recorre los títulos del home de RichardFlix
 * (mismas listas TMDB que Home.tsx) y guarda sus embeds de UnlimPlay en Firestore.
 * Lo dispara un cron externo con POST /rf/stream/warm (header x-warm-key).
 */
import type { Router } from "express";
import { unlimEmbedsKey, warmUnlimEmbeds } from "./richardflixStream.js";
import { vodCacheAges, vodCacheEnabled } from "./rfVodCache.js";

const TMDB_KEY = process.env.TMDB_API_KEY || "26628384794d4a3212ae889044e6340e";
const TMDB = "https://api.themoviedb.org/3";

/** Más viejo que esto se vuelve a pedir; el TTL de lectura es 8 h. */
const STALE_MS = 5 * 60 * 60 * 1000;
const CONCURRENCY = 3;

const HOME_MOVIE_GENRE_IDS = [28, 35, 18, 27, 878, 16, 10749, 12];
const HOME_TV_GENRE_IDS = [18, 35, 80, 10765, 16, 10759, 9648];
const MX_PROVIDERS = [8, 337, 119];

type Target = { type: "movie" | "tv"; tmdbId: number; season?: number; episode?: number };

type WarmStatus = {
  running: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  total: number;
  stale: number;
  done: number;
  ok: number;
  empty: number;
  error: number;
  stoppedReason: string | null;
};

const status: WarmStatus = {
  running: false,
  startedAt: null,
  finishedAt: null,
  total: 0,
  stale: 0,
  done: 0,
  ok: 0,
  empty: 0,
  error: 0,
  stoppedReason: null,
};

async function tmdbList(
  path: string,
  params: Record<string, string> = {},
): Promise<Array<{ id: number; media_type?: string }>> {
  const qs = new URLSearchParams({
    api_key: TMDB_KEY,
    language: "es-MX",
    region: "MX",
    page: "1",
    ...params,
  });
  try {
    const res = await fetch(`${TMDB}${path}?${qs}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: Array<{ id: number; media_type?: string }> };
    return data.results ?? [];
  } catch {
    return [];
  }
}

export async function homeTargets(): Promise<Target[]> {
  const discover = { sort_by: "popularity.desc", include_adult: "false" };
  const provider = (id: number) => ({
    ...discover,
    with_watch_providers: String(id),
    watch_region: "MX",
    with_watch_monetization_types: "flatrate|free|ads",
  });

  const lists: Array<[Promise<Array<{ id: number; media_type?: string }>>, "movie" | "tv" | "mixed"]> = [
    [tmdbList("/trending/all/day"), "mixed"],
    [tmdbList("/trending/all/week"), "mixed"],
    [tmdbList("/trending/movie/day"), "movie"],
    [tmdbList("/trending/tv/day"), "tv"],
    [tmdbList("/movie/popular"), "movie"],
    [tmdbList("/movie/top_rated"), "movie"],
    [tmdbList("/movie/now_playing"), "movie"],
    [tmdbList("/movie/upcoming"), "movie"],
    [tmdbList("/tv/popular"), "tv"],
    [tmdbList("/tv/top_rated"), "tv"],
    [tmdbList("/tv/on_the_air"), "tv"],
    [tmdbList("/tv/airing_today"), "tv"],
    [tmdbList("/discover/movie", { ...discover, with_original_language: "es" }), "movie"],
    ...MX_PROVIDERS.map(
      (id) => [tmdbList("/discover/movie", provider(id)), "movie"] as [ReturnType<typeof tmdbList>, "movie"],
    ),
    ...HOME_MOVIE_GENRE_IDS.map(
      (g) =>
        [tmdbList("/discover/movie", { ...discover, with_genres: String(g) }), "movie"] as [
          ReturnType<typeof tmdbList>,
          "movie",
        ],
    ),
    ...HOME_TV_GENRE_IDS.map(
      (g) =>
        [tmdbList("/discover/tv", { ...discover, with_genres: String(g) }), "tv"] as [
          ReturnType<typeof tmdbList>,
          "tv",
        ],
    ),
  ];

  const seen = new Set<string>();
  const out: Target[] = [];
  for (const [promise, kind] of lists) {
    for (const r of await promise) {
      const type =
        kind === "mixed" ? (r.media_type === "tv" ? "tv" : r.media_type === "movie" ? "movie" : null) : kind;
      if (!type || !r.id) continue;
      const t: Target = type === "tv" ? { type, tmdbId: r.id, season: 1, episode: 1 } : { type, tmdbId: r.id };
      const k = unlimEmbedsKey(t);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
  }
  return out;
}

async function runCycle(): Promise<void> {
  Object.assign(status, {
    running: true,
    startedAt: Date.now(),
    finishedAt: null,
    total: 0,
    stale: 0,
    done: 0,
    ok: 0,
    empty: 0,
    error: 0,
    stoppedReason: null,
  });
  try {
    const targets = await homeTargets();
    const ages = await vodCacheAges(targets.map(unlimEmbedsKey));
    const now = Date.now();
    const queue = targets.filter((t) => now - (ages.get(unlimEmbedsKey(t)) ?? 0) > STALE_MS);
    status.total = targets.length;
    status.stale = queue.length;

    let downStreak = 0;
    const worker = async () => {
      while (queue.length && !status.stoppedReason) {
        const t = queue.shift()!;
        const r = await warmUnlimEmbeds(t);
        status.done++;
        if (r === "ok") status.ok++;
        else if (r === "empty") status.empty++;
        else status.error++;
        downStreak = r === "down" ? downStreak + 1 : 0;
        if (downStreak >= 3) status.stoppedReason = "unlimplay_down";
        await new Promise((res) => setTimeout(res, 500));
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  } catch (e) {
    status.stoppedReason = e instanceof Error ? e.message : "error";
  } finally {
    status.running = false;
    status.finishedAt = Date.now();
    console.log("[rfVodWarm]", JSON.stringify(status));
  }
}

export function mountRfVodWarm(router: Router): void {
  router.post("/stream/warm", (req, res) => {
    const expected = process.env.RF_WARM_KEY;
    if (!expected || req.get("x-warm-key") !== expected) {
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }
    if (!vodCacheEnabled()) {
      res.status(503).json({ ok: false, error: "RF_FIREBASE_SA no configurado" });
      return;
    }
    const start = req.query.start === "1" && !status.running;
    if (start) void runCycle();
    res.json({ started: start, ...status });
  });
}
