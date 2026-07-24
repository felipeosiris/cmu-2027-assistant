import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { Agent, CursorAgentError } from "@cursor/sdk";
import { Communicate } from "edge-tts-universal";
import { v4 as uuidv4 } from "uuid";
import {
  buildLiveContext,
  fetchNearbyRestaurants,
  fetchWeather,
  voiceSummaryFromMarkdown,
} from "./tools.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const PORT = Number(process.env.PORT || 8788);
const bundledVault = path.resolve(rootDir, "vault");
const siblingVault = path.resolve(rootDir, "..", "CMU-2027");
const VAULT_CWD =
  process.env.VAULT_CWD ||
  (fs.existsSync(bundledVault) ? bundledVault : siblingVault);
const API_KEY = process.env.CURSOR_API_KEY || "";
const MODEL_ID = process.env.CURSOR_MODEL || "auto";
/** Voz natural ES-MX (Edge TTS). */
const TTS_VOICE = process.env.TTS_VOICE || "es-MX-DaliaNeural";

type Session = {
  id: string;
  agent: Awaited<ReturnType<typeof Agent.create>>;
  createdAt: number;
  title?: string;
};

const sessions = new Map<string, Session>();

const SYSTEM_HINT = `
Eres el Asistente CMU 2027: guía inteligente y PROACTIVO del Plan Estratégico y del 50° Congreso CMU (Puerto Vallarta, 2–6 jun 2026).

Trabajas con el filesystem de la carpeta CMU-2027 (cwd). Lee notas markdown. También recibirás bloques de DATOS EN VIVO (clima Open-Meteo y restaurantes Google Places) — úsalos; no inventes clima ni ratings.

Reglas:
- Español claro y directo. Empieza SIEMPRE con 1–2 frases de veredicto útil (esto es lo que se leerá en voz).
- Sé proactivo: si hay calor, sugiere ropa; si hay hueco entre sesiones, sugiere comida cercana; si preguntan por una ponencia, cruza programa + persona + clima/comida si aporta.
- Prioriza: Congreso-2026/, Personas/, APIs/APIs-externas.md, CMU-2027.md, Vision, etc.
- Listas/comparativas → tablas markdown. Gráficas → \`\`\`mermaid (pie, flowchart, xychart-beta) + tabla.
- No inventes horarios ni nombres que no estén en la bóveda o en los datos en vivo.
- No pegues API keys ni secretos.
`.trim();

async function getOrCreateSession(sessionId?: string): Promise<Session> {
  if (!API_KEY) {
    throw new Error(
      "Falta CURSOR_API_KEY. Cópiala en cmu-ai/.env (Dashboard Cursor → API Keys)."
    );
  }

  if (sessionId && sessions.has(sessionId)) {
    return sessions.get(sessionId)!;
  }

  const id = sessionId || uuidv4();
  const agent = await Agent.create({
    apiKey: API_KEY,
    model: { id: MODEL_ID },
    local: { cwd: VAULT_CWD },
  });

  const session: Session = { id, agent, createdAt: Date.now() };
  sessions.set(id, session);
  return session;
}

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    vaultCwd: VAULT_CWD,
    model: MODEL_ID,
    hasApiKey: Boolean(API_KEY),
    hasPlacesKey: Boolean(process.env.GOOGLE_PLACES_API_KEY),
    sessions: sessions.size,
    ttsVoice: TTS_VOICE,
    mode: "local",
  });
});

app.get("/api/tools/weather", async (_req, res) => {
  try {
    res.json(await fetchWeather());
  } catch (e) {
    res.status(502).json({
      error: e instanceof Error ? e.message : "weather error",
    });
  }
});

app.get("/api/tools/restaurants", async (_req, res) => {
  try {
    res.json({ places: await fetchNearbyRestaurants() });
  } catch (e) {
    res.status(502).json({
      error: e instanceof Error ? e.message : "places error",
    });
  }
});

/** TTS natural (Edge) — solo resumen corto. */
app.post("/api/speak", async (req, res) => {
  const raw = String(req.body?.text || "").trim();
  if (!raw) {
    res.status(400).json({ error: "text vacío" });
    return;
  }
  const summary = voiceSummaryFromMarkdown(raw, 280);
  try {
    const communicate = new Communicate(summary, { voice: TTS_VOICE });
    const chunks: Buffer[] = [];
    for await (const chunk of communicate.stream()) {
      if (chunk.type === "audio" && chunk.data) chunks.push(Buffer.from(chunk.data));
    }
    const audio = Buffer.concat(chunks);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("X-Voice-Summary", encodeURIComponent(summary));
    res.send(audio);
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : "tts error",
      summary,
    });
  }
});

app.post("/api/chat", async (req, res) => {
  const prompt = String(req.body?.prompt || "").trim();
  const sessionId = req.body?.sessionId
    ? String(req.body.sessionId)
    : undefined;

  if (!prompt) {
    res.status(400).json({ error: "prompt vacío" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const live = await buildLiveContext(prompt);
    send("context", { hasLive: Boolean(live) });

    const session = await getOrCreateSession(sessionId);
    send("session", { sessionId: session.id });

    const fullPrompt = `${SYSTEM_HINT}

---
DATOS EN VIVO (úsalos si aplican; no inventes fuera de esto):
${live || "(sin datos en vivo)"}

---
Pregunta del usuario:
${prompt}`;

    const run = await session.agent.send(fullPrompt);

    let text = "";
    for await (const event of run.stream()) {
      if (event.type === "assistant") {
        for (const block of event.message.content) {
          if (block.type === "text" && block.text) {
            text += block.text;
            send("delta", { text: block.text });
          }
        }
      }
    }

    const result = await run.wait();
    if (result.status === "error") {
      send("error", {
        message: "El agente terminó con error",
        runId: result.id,
      });
    } else {
      const finalText = result.result || text;
      const voiceSummary = voiceSummaryFromMarkdown(finalText);
      send("done", {
        text: finalText,
        voiceSummary,
        model: result.model,
        status: result.status,
      });
    }
  } catch (err) {
    const message =
      err instanceof CursorAgentError
        ? `Cursor: ${err.message}`
        : err instanceof Error
          ? err.message
          : "Error desconocido";
    send("error", { message });
  } finally {
    res.end();
  }
});

app.post("/api/session/reset", async (req, res) => {
  const sessionId = String(req.body?.sessionId || "");
  const existing = sessions.get(sessionId);
  if (existing) {
    try {
      await existing.agent[Symbol.asyncDispose]();
    } catch {
      /* ignore */
    }
    sessions.delete(sessionId);
  }
  res.json({ ok: true });
});

const clientDist = path.join(rootDir, "client", "dist");
app.use(express.static(clientDist));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.join(clientDist, "index.html"), (err) => {
    if (err) next();
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Asistente CMU 2027 → http://0.0.0.0:${PORT}`);
  console.log(`Vault cwd          → ${VAULT_CWD}`);
  console.log(`Model              → ${MODEL_ID}`);
  console.log(`API key            → ${API_KEY ? "ok" : "MISSING (.env)"}`);
  console.log(`Places             → ${process.env.GOOGLE_PLACES_API_KEY ? "ok" : "fallback FanPass"}`);
  console.log(`TTS                → ${TTS_VOICE}`);
});
