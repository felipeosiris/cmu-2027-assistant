import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { Agent, CursorAgentError } from "@cursor/sdk";
import { v4 as uuidv4 } from "uuid";

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

type Session = {
  id: string;
  agent: Awaited<ReturnType<typeof Agent.create>>;
  createdAt: number;
};

const sessions = new Map<string, Session>();

const SYSTEM_HINT = `
Eres el Asistente CMU 2027: conocimiento del Plan Estratégico de Transformación Digital del Congreso del Colegio Mexicano de Urología.

Trabajas solo con el filesystem de la carpeta CMU-2027 (cwd). Lee las notas markdown ahí.

Reglas:
- Responde siempre en español, claro y directo.
- Prioriza notas: CMU-2027.md, Vision, Diagnostico, Congreso-2026/, Personas/, Objetivos, CMU-Experience, Ecosistema, Innovation-Hub, Monetización, Plataforma 365, Analítica, Servicios, Indicadores, Próximos pasos, Asistente-IA-ejemplos.
- Si preguntan por personas o programa del 50° Congreso, usa Personas/ y Congreso-2026/.
- Si piden listas o comparativas, usa tablas markdown.
- Si piden gráficas, usa bloques \`\`\`mermaid con diagramas compatibles: pie, flowchart, xychart-beta, timeline, quadrantChart. Cierra siempre el fence. Incluye también la tabla de datos debajo.
- No inventes: si no está en la bóveda, dilo.
- Para respuestas cortas de voz, empieza con 1-2 frases de veredicto y luego el detalle.
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
    sessions: sessions.size,
    mode: "local",
  });
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
    const session = await getOrCreateSession(sessionId);
    send("session", { sessionId: session.id });

    const fullPrompt = `${SYSTEM_HINT}\n\n---\nPregunta del usuario:\n${prompt}`;
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
      send("done", {
        text: result.result || text,
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
});
