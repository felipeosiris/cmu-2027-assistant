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
  fetchNearbyPlaces,
  fetchNearbyRestaurants,
  fetchWeather,
  cicVenuePlace,
  voiceSummaryFromMarkdown,
} from "./tools.js";
import {
  buildMedicalContext,
  searchClinicalTrials,
  searchPubMed,
  searchRxNorm,
  searchOpenFdaLabel,
} from "./medical.js";
import {
  CONGRESS,
  ROOMS,
  SESSIONS,
  SPEAKER_FICHAS,
  SPONSORS,
  getAgendaAt,
  findRoom,
  findSessions,
  findSponsors,
} from "./program.js";
import { buildPdfBuffer } from "./pdfExport.js";
import { enrichSpeakersWithPhotos } from "./speakerPhotos.js";
import { createRichardflixSportsRouter } from "./richardflixSportsrc.js";

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
Eres el Asistente CMU 2027: guía inteligente y PROACTIVO del Plan Estratégico CMU, del 50° Congreso (Puerto Vallarta, 2–6 jun 2026) y del próximo 51° Congreso Internacional de Urología (Tijuana, BC, 11–15 abr 2027).

Trabajas con el filesystem CMU-2027 (cwd) y DATOS EN VIVO (clima, sede CIC 2026, lugares con mapas, programa estructurado, patrocinadores, fichas de ponentes, y APIs médicas: RxNorm, OpenFDA, ClinicalTrials.gov, PubMed). No inventes clima, ratings, coordenadas, horarios ni datos clínicos.

Próximo congreso (flyer + cmu.org.mx): 51° · 11–15 abril 2027 · Tijuana, Baja California · web cmu.org.mx · tel 55 9000 2092 / 2093. Aún no hay sede hotel/centro ni programa día a día publicado: dilo si preguntan; no inventes. Hay convocatoria a Vicepresidencia 2027–2029 en el sitio.

Reglas:
- Español claro. Empieza con 1–2 frases de veredicto (se leen en voz).
- Sé proactivo: clima/ropa, agenda ahora/siguiente, salón de la sesión, patrocinios, ponentes, comer/café, hotel, estacionamiento, farmacia, urgencias, fármacos/ensayos/evidencia, fechas Tijuana 2027.
- Si hay agenda en vivo: tabla corta de “en curso” y “siguiente” con salón. Di si el reloj es demo.
- Si preguntan salón (Maito, Quimixto, Caletas, Majahuitas): responde con salón + sesiones ahí.
- Si preguntan patrocinadores: usa el JSON (Oro/Plata/Bronce/actividades). Astellas/Boston/TENA/Silanes/Liomont/AstraZeneca tienen actividades ligadas (algunas marcadas DEMO).
- Productos demo: Urizia (ficha en Productos/), ZeroTip Boston (120 cm referencia; trivia 120/150/200).
- Stands demo: Area-comercial-stands.md (Astellas A-12, Boston B-08, Liomont C-04, AZ A-14; bahías R-01/R-02/R-03 robots).
- Si preguntan resumen AstraZeneca: usa Resumen-AstraZeneca-DEMO.md.
- Si preguntan LHRH sin bicalutamida: usa Nota-LHRH-sin-bicalutamida.md + disclaimer.
- Si hay lugares en el JSON en vivo, resume en tabla corta; la UI mostrará mini mapas solos.
- Si hay datos médicos en vivo: tablas + enlaces + disclaimer una vez; no inventes dosis.
- Personas/fotos: si hay path de foto, \`![Nombre](/api/vault/...)\`. Si el JSON trae photoHit con confidence≥0.9, USA esa foto (proactivo). Si no hay foto segura, dilo en una frase; no inventes plantillas [FOTO 3x4].
- Prioriza el índice estructurado del programa sobre inventar horarios del PDF.
- Listas → tablas. Gráficas → \`\`\`mermaid + tabla.
- No pegues API keys ni secretos. No ofrezcas pago online.
- Lenguaje al usuario: NUNCA digas “bóveda”, “vault”, “Obsidian” ni rutas de archivos. Habla de “información del congreso”, “base de datos interna” o “datos del CMU”.
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
  const managedCloud =
    Boolean(process.env.FUNCTION_TARGET) ||
    Boolean(process.env.K_SERVICE) ||
    process.env.CMU_AGENT_RUNTIME === "cloud";
  const agent = await Agent.create({
    apiKey: API_KEY,
    model: { id: MODEL_ID },
    ...(managedCloud
      ? {
          cloud: {
            repos: [
              {
                url: "https://github.com/felipeosiris/cmu-2027-assistant",
                startingRef: "main",
              },
            ],
          },
        }
      : { local: { cwd: VAULT_CWD } }),
  });

  const session: Session = { id, agent, createdAt: Date.now() };
  sessions.set(id, session);
  return session;
}

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));

/** RichardFlix Deportes: proxy SportSRC + caché (también en servicio aparte) */
app.use("/rf", createRichardflixSportsRouter());

app.get("/api/health", (_req, res) => {
  const managedCloud =
    Boolean(process.env.FUNCTION_TARGET) ||
    Boolean(process.env.K_SERVICE) ||
    process.env.CMU_AGENT_RUNTIME === "cloud";
  res.json({
    ok: true,
    vaultCwd: VAULT_CWD,
    model: MODEL_ID,
    hasApiKey: Boolean(API_KEY),
    hasPlacesKey: Boolean(process.env.GOOGLE_PLACES_API_KEY),
    sessions: sessions.size,
    ttsVoice: TTS_VOICE,
    ttsProvider: "edge",
    mode: managedCloud ? "cloud" : "local",
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

app.get("/api/tools/nearby", async (req, res) => {
  try {
    const type = String(req.query.type || "restaurant") as
      | "restaurant"
      | "cafe"
      | "lodging"
      | "parking"
      | "pharmacy"
      | "hospital"
      | "atm";
    const label = String(req.query.label || type);
    const places = await fetchNearbyPlaces(type, label);
    res.json({ venue: cicVenuePlace(), places });
  } catch (e) {
    res.status(502).json({
      error: e instanceof Error ? e.message : "nearby error",
    });
  }
});

app.get("/api/tools/venue", (_req, res) => {
  res.json(cicVenuePlace());
});

app.get("/api/tools/medical", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) {
      res.status(400).json({ error: "falta ?q=" });
      return;
    }
    const bundle = await buildMedicalContext(q);
    res.json(bundle || { query: q, empty: true });
  } catch (e) {
    res.status(502).json({
      error: e instanceof Error ? e.message : "medical error",
    });
  }
});

app.get("/api/tools/rxnorm", async (req, res) => {
  try {
    const name = String(req.query.name || "").trim();
    if (!name) {
      res.status(400).json({ error: "falta ?name=" });
      return;
    }
    res.json({ hits: await searchRxNorm(name) });
  } catch (e) {
    res.status(502).json({
      error: e instanceof Error ? e.message : "rxnorm error",
    });
  }
});

app.get("/api/tools/trials", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) {
      res.status(400).json({ error: "falta ?q=" });
      return;
    }
    res.json({ trials: await searchClinicalTrials(q) });
  } catch (e) {
    res.status(502).json({
      error: e instanceof Error ? e.message : "trials error",
    });
  }
});

app.get("/api/tools/pubmed", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) {
      res.status(400).json({ error: "falta ?q=" });
      return;
    }
    res.json({ papers: await searchPubMed(q) });
  } catch (e) {
    res.status(502).json({
      error: e instanceof Error ? e.message : "pubmed error",
    });
  }
});

app.get("/api/tools/openfda", async (req, res) => {
  try {
    const name = String(req.query.name || "").trim();
    if (!name) {
      res.status(400).json({ error: "falta ?name=" });
      return;
    }
    res.json({ label: await searchOpenFdaLabel(name) });
  } catch (e) {
    res.status(502).json({
      error: e instanceof Error ? e.message : "openfda error",
    });
  }
});

app.get("/api/program", (_req, res) => {
  res.json({
    congress: CONGRESS,
    rooms: ROOMS,
    sponsors: SPONSORS,
    sessions: SESSIONS,
    speakers: SPEAKER_FICHAS,
  });
});

app.get("/api/program/agenda", (req, res) => {
  const at = req.query.at ? String(req.query.at) : null;
  res.json(getAgendaAt(at));
});

app.get("/api/program/rooms", (req, res) => {
  const q = String(req.query.q || "").trim();
  if (q) {
    const room = findRoom(q);
    res.json({
      room,
      sessions: findSessions(q).slice(0, 20),
      rooms: room ? [room] : ROOMS,
    });
    return;
  }
  res.json({ rooms: ROOMS });
});

app.get("/api/program/sponsors", (req, res) => {
  const q = String(req.query.q || "").trim();
  res.json({ sponsors: findSponsors(q || undefined) });
});

app.get("/api/program/search", (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) {
    res.status(400).json({ error: "falta ?q=" });
    return;
  }
  res.json({ sessions: findSessions(q) });
});

app.get("/api/program/speakers", async (_req, res) => {
  try {
    const speakers = await enrichSpeakersWithPhotos(SPEAKER_FICHAS, VAULT_CWD);
    res.json({ speakers });
  } catch (e) {
    res.status(502).json({
      error: e instanceof Error ? e.message : "speakers error",
    });
  }
});

app.get("/api/program/speaker-photo", async (req, res) => {
  try {
    const name = String(req.query.name || "").trim();
    if (!name) {
      res.status(400).json({ error: "falta ?name=" });
      return;
    }
    const { resolveSpeakerPhoto } = await import("./speakerPhotos.js");
    const existing = SPEAKER_FICHAS.find((s) =>
      s.name.toLowerCase() === name.toLowerCase()
    )?.photo;
    const hit = await resolveSpeakerPhoto(name, VAULT_CWD, existing);
    res.json({ hit });
  } catch (e) {
    res.status(502).json({
      error: e instanceof Error ? e.message : "photo error",
    });
  }
});

app.post("/api/export/pdf", async (req, res) => {
  try {
    const title = String(req.body?.title || "Respuesta Asistente CMU").slice(0, 120);
    const body = String(req.body?.text || req.body?.body || "").slice(0, 50000);
    if (!body.trim()) {
      res.status(400).json({ error: "text vacío" });
      return;
    }
    const pdf = await buildPdfBuffer({ title, body });
    const safe = title.replace(/[^\w\-]+/g, "_").slice(0, 40) || "cmu";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safe}.pdf"`
    );
    res.send(pdf);
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : "pdf error",
    });
  }
});

/** Sirve archivos de la bóveda (fotos, etc.) de forma segura. */
app.use("/api/vault", (req, res, next) => {
  if (req.method !== "GET") {
    next();
    return;
  }
  const rel = decodeURIComponent(req.path.replace(/^\/+/, ""));
  if (!rel || rel.includes("..") || path.isAbsolute(rel)) {
    res.status(400).json({ error: "ruta inválida" });
    return;
  }
  const abs = path.resolve(VAULT_CWD, rel);
  if (!abs.startsWith(path.resolve(VAULT_CWD) + path.sep)) {
    res.status(403).json({ error: "acceso denegado" });
    return;
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    res.status(404).json({ error: "no encontrado" });
    return;
  }
  res.sendFile(abs);
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
    res.setHeader("X-TTS-Provider", `edge:${TTS_VOICE}`);
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
    // Paralelizar: sesión Agent + contexto en vivo (sin atajos falsos)
    const livePromise = buildLiveContext(prompt, VAULT_CWD);
    const sessionPromise = getOrCreateSession(sessionId);
    const [live, session] = await Promise.all([livePromise, sessionPromise]);
    send("context", { hasLive: Boolean(live.markdown) });
    if (live.places.length) {
      const mapPlaces = live.places
        .filter((p) => p.category !== "sede")
        .slice(0, 8);
      if (mapPlaces.length || live.venue) {
        send("places", {
          places: mapPlaces,
          venue: mapPlaces.length ? null : live.venue ?? null,
        });
      }
    }

    send("session", { sessionId: session.id });

    const fullPrompt = `${SYSTEM_HINT}

---
DATOS EN VIVO (prioridad: úsalos; no inventes fuera de esto):
${live.markdown || "(sin datos en vivo)"}

---
Velocidad: si los DATOS EN VIVO ya responden la pregunta, contesta de inmediato con veredicto + tabla. Solo busca en el filesystem si falta un dato concreto (máx. 2 lecturas). No listes directorios enteros.

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
const skipListen =
  Boolean(process.env.FUNCTION_TARGET) ||
  Boolean(process.env.K_SERVICE) ||
  process.env.CMU_SKIP_LISTEN === "1";

if (!skipListen) {
  app.use(express.static(clientDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/rf")) return next();
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
    console.log(`Static UI          → ${fs.existsSync(clientDist) ? clientDist : "missing (run npm run build)"}`);
    // Precalienta una sesión Agent para la 1ª pregunta del demo
    if (API_KEY) {
      void getOrCreateSession()
        .then((s) => console.log(`Agent warmup     → session ${s.id.slice(0, 8)}…`))
        .catch((e) =>
          console.warn(
            "Agent warmup fail →",
            e instanceof Error ? e.message : e
          )
        );
    }
  });
}

export { app };
