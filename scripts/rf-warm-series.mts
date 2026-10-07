// Precarga todos los episodios de una serie en vodCache (Firestore).
// RF_FIREBASE_SA=$(cat ~/.richardflix/RF_FIREBASE_SA.txt) TMDB_KEY=... npx tsx scripts/rf-warm-series.mts <tmdbId>
import { warmUnlimEmbeds } from "../server/richardflixStream.ts";
const KEY = process.env.TMDB_KEY!; const id = Number(process.argv[2] ?? 60573);
const show = await (await fetch(`https://api.themoviedb.org/3/tv/${id}?api_key=${KEY}&language=es-MX`)).json() as any;
const eps: {season:number;episode:number}[] = [];
for (const s of show.seasons ?? []) { if (!s.season_number) continue; for (let e=1;e<=s.episode_count;e++) eps.push({season:s.season_number,episode:e}); }
console.log(show.name, "episodios:", eps.length);
const res: Record<string,number> = {}; const fails: string[] = [];
const worker = async () => { while (eps.length) { const x = eps.shift()!; const r = await warmUnlimEmbeds({type:"tv",tmdbId:id,...x}); res[r]=(res[r]??0)+1; if (r!=="ok") fails.push(`T${x.season}E${x.episode}:${r}`); } };
await Promise.all([worker(),worker(),worker()]);
console.log("resultado", res, fails.length ? "sin servidores/fallo: "+fails.join(" ") : "");
process.exit(0);
