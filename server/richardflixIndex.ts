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
      "GET /rf/sports/:tab  (wnba|liga-mx|leagues-cup|nfl)",
      "GET /rf/sports/detail?api=v1|v2&id=&category=",
      "GET /rf/sportsrc/...  (proxy SportSRC con caché)",
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
