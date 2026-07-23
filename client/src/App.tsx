import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MarkdownBody } from "./MarkdownBody";

type Role = "user" | "assistant" | "system";

type Msg = {
  id: string;
  role: Role;
  text: string;
  streaming?: boolean;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((ev: {
        results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
      }) => void)
    | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

/** Solo Firebase Hosting es estático (sin API). Render / local sí tienen backend. */
const IS_STATIC =
  typeof window !== "undefined" &&
  /(\.web\.app|\.firebaseapp\.com)$/i.test(window.location.hostname);

function uid() {
  return crypto.randomUUID();
}

function getRecognition(): SpeechRecognitionLike | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

function speak(text: string, enabled: boolean) {
  if (!enabled || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const clean = text
    .replace(/```[\s\S]*?```/g, " bloque de código ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#*_`|>-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
  if (!clean) return;
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = "es-MX";
  u.rate = 1.02;
  const voices = window.speechSynthesis.getVoices();
  const es = voices.find((v) => v.lang.startsWith("es"));
  if (es) u.voice = es;
  window.speechSynthesis.speak(u);
}

export default function App() {
  const [messages, setMessages] = useState<Msg[]>([
    {
      id: uid(),
      role: "system",
      text: IS_STATIC
        ? "Vista publicada en Firebase Hosting (solo UI). El chat con Cursor SDK requiere correr el asistente en local: cd cmu-ai && npm run dev"
        : "Pregúntame sobre el Plan Estratégico CMU 2027. Puedes hablar con el micrófono; las respuestas se pueden oír en voz alta.",
    },
  ]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceOut, setVoiceOut] = useState(true);
  const [health, setHealth] = useState<{
    hasApiKey?: boolean;
    model?: string;
    vaultCwd?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const inputRef = useRef(input);
  inputRef.current = input;

  useEffect(() => {
    if (IS_STATIC) return;
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth(null));
    window.speechSynthesis?.getVoices();
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, busy]);

  const send = useCallback(
    async (raw: string) => {
      const prompt = raw.trim();
      if (!prompt || busy || IS_STATIC) return;
      setError(null);
      setInput("");
      const userMsg: Msg = { id: uid(), role: "user", text: prompt };
      const assistantId = uid();
      setMessages((m) => [
        ...m,
        userMsg,
        { id: assistantId, role: "assistant", text: "", streaming: true },
      ]);
      setBusy(true);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, sessionId }),
        });
        if (!res.ok || !res.body) {
          throw new Error(`HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let full = "";

        const handleEvent = (event: string, data: string) => {
          let parsed: Record<string, unknown> = {};
          try {
            parsed = JSON.parse(data);
          } catch {
            return;
          }
          if (event === "session" && typeof parsed.sessionId === "string") {
            setSessionId(parsed.sessionId);
          }
          if (event === "delta" && typeof parsed.text === "string") {
            full += parsed.text;
            setMessages((m) =>
              m.map((msg) =>
                msg.id === assistantId
                  ? { ...msg, text: full, streaming: true }
                  : msg
              )
            );
          }
          if (event === "done") {
            const finalText =
              (typeof parsed.text === "string" && parsed.text) || full;
            full = finalText;
            setMessages((m) =>
              m.map((msg) =>
                msg.id === assistantId
                  ? { ...msg, text: finalText, streaming: false }
                  : msg
              )
            );
            speak(finalText, voiceOut);
          }
          if (event === "error") {
            const msg =
              typeof parsed.message === "string"
                ? parsed.message
                : "Error en el agente";
            setError(msg);
            setMessages((m) =>
              m.map((x) =>
                x.id === assistantId
                  ? { ...x, text: x.text || `⚠️ ${msg}`, streaming: false }
                  : x
              )
            );
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";
          for (const chunk of parts) {
            const lines = chunk.split("\n");
            let event = "message";
            let data = "";
            for (const line of lines) {
              if (line.startsWith("event:")) event = line.slice(6).trim();
              if (line.startsWith("data:")) data += line.slice(5).trim();
            }
            if (data) handleEvent(event, data);
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Error de red";
        setError(msg);
        setMessages((m) =>
          m.map((x) =>
            x.streaming ? { ...x, text: `⚠️ ${msg}`, streaming: false } : x
          )
        );
      } finally {
        setBusy(false);
      }
    },
    [busy, sessionId, voiceOut]
  );

  const toggleListen = () => {
    if (IS_STATIC) return;
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const rec = getRecognition();
    if (!rec) {
      setError("Tu navegador no soporta reconocimiento de voz. Usa Chrome.");
      return;
    }
    recognitionRef.current = rec;
    rec.lang = "es-MX";
    rec.continuous = false;
    rec.interimResults = true;
    let finalText = "";
    rec.onresult = (ev) => {
      let interim = "";
      for (let i = 0; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      setInput((finalText + " " + interim).trim());
    };
    rec.onerror = (ev) => {
      setError(`Voz: ${ev.error}`);
      setListening(false);
    };
    rec.onend = () => {
      setListening(false);
      const t = finalText.trim() || inputRef.current.trim();
      if (t) void send(t);
    };
    try {
      window.speechSynthesis?.cancel();
      rec.start();
      setListening(true);
      setError(null);
    } catch {
      setError("No se pudo iniciar el micrófono");
      setListening(false);
    }
  };

  const resetSession = async () => {
    if (IS_STATIC) return;
    if (sessionId) {
      await fetch("/api/session/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
    }
    setSessionId(null);
    setMessages([
      {
        id: uid(),
        role: "system",
        text: "Sesión reiniciada. Pregunta de nuevo sobre CMU 2027.",
      },
    ]);
  };

  const suggestions = useMemo(
    () => [
      "¿Cuál es la visión del plan CMU 2027?",
      "Resume el modelo de monetización",
      "¿Qué es el Innovation Hub?",
      "Lista los próximos pasos",
    ],
    []
  );

  return (
    <div className="page">
      <div className="atmosphere" aria-hidden />
      <header className="hero">
        <h1 className="brand">
          <span className="brand-prefix">Asistente</span>{" "}
          <span className="brand-cmu">CMU 2027</span>
        </h1>
        <p className="lede">
          Plan Estratégico de Transformación Digital del Colegio Mexicano de
          Urología.
        </p>
        <div className="meta">
          {IS_STATIC ? (
            <span className="pill warn">Hosting estático · chat solo local</span>
          ) : (
            <>
              <span className={health?.hasApiKey ? "pill ok" : "pill warn"}>
                {health?.hasApiKey ? "API key OK" : "Falta CURSOR_API_KEY"}
              </span>
              <span className="pill">{health?.model || "…"}</span>
              <span className="pill mono" title={health?.vaultCwd}>
                CMU-2027
              </span>
            </>
          )}
        </div>
      </header>

      <main className="shell">
        <div className="chat" ref={listRef}>
          {messages.map((m) => (
            <article key={m.id} className={`bubble ${m.role}`}>
              {m.role === "assistant" ? (
                <MarkdownBody text={m.text} streaming={m.streaming} />
              ) : (
                <div
                  className="bubble-body"
                  dangerouslySetInnerHTML={{
                    __html: escapeHtml(m.text).replace(/\n/g, "<br/>"),
                  }}
                />
              )}
              {m.streaming && <span className="cursor-blink" />}
            </article>
          ))}
        </div>

        {!IS_STATIC && (
          <div className="suggestions">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void send(s)}
                disabled={busy}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {error && <p className="error">{error}</p>}

        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <button
            type="button"
            className={`mic ${listening ? "hot" : ""}`}
            onClick={toggleListen}
            title="Hablar"
            aria-pressed={listening}
            disabled={IS_STATIC}
          >
            {listening ? "Escuchando…" : "Mic"}
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              IS_STATIC
                ? "Chat deshabilitado en Hosting — usa npm run dev"
                : "Pregunta sobre visión, monetización, Innovation Hub…"
            }
            rows={2}
            disabled={IS_STATIC}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
          />
          <div className="actions">
            <label className="toggle">
              <input
                type="checkbox"
                checked={voiceOut}
                disabled={IS_STATIC}
                onChange={(e) => {
                  setVoiceOut(e.target.checked);
                  if (!e.target.checked) window.speechSynthesis?.cancel();
                }}
              />
              Voz respuesta
            </label>
            <button
              type="button"
              className="ghost"
              onClick={() => void resetSession()}
              disabled={IS_STATIC}
            >
              Nueva sesión
            </button>
            <button
              type="submit"
              className="send"
              disabled={IS_STATIC || busy || !input.trim()}
            >
              {busy ? "Pensando…" : "Enviar"}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
