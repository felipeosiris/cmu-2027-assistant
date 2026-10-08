// Fija una serie (vodPinned) y precarga todos sus episodios en vodCache (Firestore).
// El cron de /rf/stream/warm la refresca cada 6 h.
// RF_FIREBASE_SA=$(cat ~/.richardflix/RF_FIREBASE_SA.txt) TMDB_KEY=... npx tsx scripts/rf-warm-series.mts <tmdbId>
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { warmUnlimEmbeds } from "../server/richardflixStream.ts";

const KEY = process.env.TMDB_KEY!;
const id = Number(process.argv[2]);
if (!id) throw new Error("uso: rf-warm-series.mts <tmdbId>");

const sa = JSON.parse(Buffer.from(process.env.RF_FIREBASE_SA!, "base64").toString());
const db = getFirestore(initializeApp({ credential: cert(sa) }, "pin"));

const show = (await (await fetch(`https://api.themoviedb.org/3/tv/${id}?api_key=${KEY}&language=es-MX`)).json()) as any;
await db.collection("vodPinned").doc(String(id)).set({ name: show.name, pinnedAt: Date.now() });

const eps: { season: number; episode: number }[] = [];
for (const s of show.seasons ?? []) {
  if (!s.season_number) continue;
  for (let e = 1; e <= s.episode_count; e++) eps.push({ season: s.season_number, episode: e });
}
console.log(show.name, "fijada; episodios:", eps.length);

const res: Record<string, number> = {};
const fails: string[] = [];
const worker = async () => {
  while (eps.length) {
    const x = eps.shift()!;
    const r = await warmUnlimEmbeds({ type: "tv", tmdbId: id, ...x });
    res[r] = (res[r] ?? 0) + 1;
    if (r !== "ok") fails.push(`T${x.season}E${x.episode}:${r}`);
  }
};
await Promise.all([worker(), worker(), worker()]);
console.log("resultado", res, fails.length ? "fallos: " + fails.join(" ") : "");
process.exit(0);
