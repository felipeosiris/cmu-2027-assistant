/**
 * Backend aparte RichardFlix Sports (misma plataforma Render que CMU Assistant).
 * Arranque: npx tsx server/richardflixIndex.ts
 */
import "dotenv/config";
import cors from "cors";
import express from "express";
import { createRichardflixSportsRouter } from "./richardflixSportsrc.js";

const PORT = Number(process.env.PORT || 8790);

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "256kb" }));

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "richardflix-sports",
    routes: [
      "GET /rf/health",
      "GET /rf/sports/:tab  (en-vivo|nba|wnba|liga-mx|leagues-cup|nfl)",
      "GET /rf/sports/detail?api=v1|v2&id=&category=",
      "GET /rf/tv/countries",
      "GET /rf/tv/channels?country=mx&kind=tv|radio",
      "GET /rf/tv/channel?country=mx&kind=tv&id=",
      "GET /rf/sportsrc/...  (proxy SportSRC con caché)",
      "GET /rf/stream/play?type=movie|tv&tmdb=&lang=latino&hostIndex=0",
      "GET /rf/stream/sources?type=movie|tv&tmdb=&lang=latino",
      "GET /rf/stream/proxy?u=&r=  (proxy HLS/mp4)",
      "POST /rf/ytm/youtubei/v1/{search|browse|player}  (YouTube Music InnerTube)",
      "GET /rf/dramas/home",
      "GET /rf/dramas/trending",
      "GET /rf/dramas/for-you",
      "GET /rf/dramas/search?q=",
      "GET /rf/dramas/:id",
      "GET /rf/dramas/:id/episodes",
      "GET /rf/dramas/:id/stream?ep=1",
      "GET /rf/dramas/trial/home",
      "GET /rf/dramas/trial/:provider/trending",
      "GET /rf/dramas/trial/:provider/:id",
      "GET /rf/dramas/trial/:provider/:id/stream?ep=1",
    ],
  });
});

app.use("/rf", createRichardflixSportsRouter());

app.listen(PORT, "0.0.0.0", () => {
  console.log(`RichardFlix Sports API → http://0.0.0.0:${PORT}`);
  console.log(`Health                 → /rf/health`);
  console.log(
    `SportSRC key           → ${process.env.SPORTSRC_API_KEY?.trim() ? "env" : "default"}`,
  );
});
