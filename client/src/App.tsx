import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MarkdownBody } from "./MarkdownBody";

type Role = "user" | "assistant" | "system";

type Msg = {
  id: string;
  role: Role;
  text: string;
  streaming?: boolean;
  voiceSummary?: string;
};

type ChatThread = {
  id: string;
  title: string;
  agentSessionId: string | null;
  messages: Msg[];
  updatedAt: number;
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

const IS_STATIC =
  typeof window !== "undefined" &&
  /(\.web\.app|\.firebaseapp\.com)$/i.test(window.location.hostname);

const STORAGE_KEY = "cmu-ai-threads-v1";

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

function welcomeMsg(): Msg {
  return {
    id: uid(),
    role: "system",
    text: IS_STATIC
      ? "Vista estática en Firebase. Para chat con clima, restaurantes y voz natural: `cd cmu-ai && npm run dev`."
      : "Soy tu asistente del 50° Congreso CMU en Puerto Vallarta. Puedo cruzar programa, personas, clima en vivo y restaurantes cerca del CIC. Pregúntame o pulsa una sugerencia.",
  };
}

function emptyThread(): ChatThread {
  return {
    id: uid(),
    title: "Nueva conversación",
    agentSessionId: null,
    messages: [welcomeMsg()],
    updatedAt: Date.now(),
  };
}

function loadThreads(): ChatThread[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [emptyThread()];
    const parsed = JSON.parse(raw) as ChatThread[];
    return parsed.length ? parsed : [emptyThread()];
  } catch {
    return [emptyThread()];
  }
}

function titleFromPrompt(prompt: string) {
  const t = prompt.trim().replace(/\s+/g, " ");
  return t.length > 42 ? `${t.slice(0, 42)}…` : t || "Nueva conversación";
}

async function speakSummary(text: string, summaryHint?: string) {
  window.speechSynthesis?.cancel();
  try {
    const res = await fetch("/api/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: summaryHint || text }),
    });
    if (!res.ok) throw new Error(`TTS ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);
    await audio.play();
  } catch {
    // Fallback browser TTS — solo resumen corto
    const clean = (summaryHint || text)
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 280);
    if (!clean || !window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = "es-MX";
    u.rate = 1;
    const voices = window.speechSynthesis.getVoices();
    const preferred =
      voices.find((v) => /dalia|sabina|paulina|mexico|es-mx/i.test(v.name)) ||
      voices.find((v) => v.lang.startsWith("es"));
    if (preferred) u.voice = preferred;
    window.speechSynthesis.speak(u);
  }
}

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export default function App() {
  const [threads, setThreads] = useState<ChatThread[]>(() =>
    typeof window !== "undefined" ? loadThreads() : [emptyThread()]
  );
  const [activeId, setActiveId] = useState(() => threads[0]?.id);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceOut, setVoiceOut] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [weatherChip, setWeatherChip] = useState<string | null>(null);
  const [health, setHealth] = useState<{
    hasApiKey?: boolean;
    model?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const inputRef = useRef(input);
  inputRef.current = input;

  const active = threads.find((t) => t.id === activeId) || threads[0];

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(threads));
  }, [threads]);

  useEffect(() => {
    if (IS_STATIC) return;
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth(null));
    fetch("/api/tools/weather")
      .then((r) => r.json())
      .then((w) => {
        if (w?.temperatureC != null) {
          setWeatherChip(
            `${Math.round(w.temperatureC)}°C · ${w.condition || "CIC PV"}`
          );
        }
      })
      .catch(() => null);
    window.speechSynthesis?.getVoices();
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [active?.messages, busy]);

  const patchActive = useCallback(
    (fn: (t: ChatThread) => ChatThread) => {
      setThreads((all) =>
        all.map((t) => (t.id === activeId ? fn({ ...t, updatedAt: Date.now() }) : t))
      );
    },
    [activeId]
  );

  const newChat = () => {
    const t = emptyThread();
    setThreads((all) => [t, ...all]);
    setActiveId(t.id);
    setError(null);
  };

  const deleteChat = (id: string) => {
    setThreads((all) => {
      const next = all.filter((t) => t.id !== id);
      if (!next.length) next.push(emptyThread());
      if (id === activeId) setActiveId(next[0].id);
      return next;
    });
  };

  const send = useCallback(
    async (raw: string) => {
      const prompt = raw.trim();
      if (!prompt || busy || IS_STATIC || !active) return;
      setError(null);
      setInput("");

      const userMsg: Msg = { id: uid(), role: "user", text: prompt };
      const assistantId = uid();
      const isFirstUser = !active.messages.some((m) => m.role === "user");

      patchActive((t) => ({
        ...t,
        title: isFirstUser ? titleFromPrompt(prompt) : t.title,
        messages: [
          ...t.messages,
          userMsg,
          { id: assistantId, role: "assistant", text: "", streaming: true },
        ],
      }));
      setBusy(true);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            sessionId: active.agentSessionId,
          }),
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let full = "";
        let voiceSummary = "";
        let agentSessionId = active.agentSessionId;

        const handleEvent = (event: string, data: string) => {
          let parsed: Record<string, unknown> = {};
          try {
            parsed = JSON.parse(data);
          } catch {
            return;
          }
          if (event === "session" && typeof parsed.sessionId === "string") {
            agentSessionId = parsed.sessionId;
            patchActive((t) => ({ ...t, agentSessionId: parsed.sessionId as string }));
          }
          if (event === "delta" && typeof parsed.text === "string") {
            full += parsed.text;
            patchActive((t) => ({
              ...t,
              messages: t.messages.map((msg) =>
                msg.id === assistantId
                  ? { ...msg, text: full, streaming: true }
                  : msg
              ),
            }));
          }
          if (event === "done") {
            const finalText =
              (typeof parsed.text === "string" && parsed.text) || full;
            full = finalText;
            voiceSummary =
              typeof parsed.voiceSummary === "string"
                ? parsed.voiceSummary
                : "";
            patchActive((t) => ({
              ...t,
              agentSessionId,
              messages: t.messages.map((msg) =>
                msg.id === assistantId
                  ? {
                      ...msg,
                      text: finalText,
                      streaming: false,
                      voiceSummary,
                    }
                  : msg
              ),
            }));
            if (voiceOut) void speakSummary(finalText, voiceSummary);
          }
          if (event === "error") {
            const msg =
              typeof parsed.message === "string"
                ? parsed.message
                : "Error en el agente";
            setError(msg);
            patchActive((t) => ({
              ...t,
              messages: t.messages.map((x) =>
                x.id === assistantId
                  ? { ...x, text: x.text || `⚠️ ${msg}`, streaming: false }
                  : x
              ),
            }));
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
        patchActive((t) => ({
          ...t,
          messages: t.messages.map((x) =>
            x.streaming ? { ...x, text: `⚠️ ${msg}`, streaming: false } : x
          ),
        }));
      } finally {
        setBusy(false);
      }
    },
    [busy, active, patchActive, voiceOut]
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
      setError("Tu navegador no soporta micrófono. Usa Chrome.");
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

  const suggestions = useMemo(
    () => [
      "¿Qué clima hay ahora en el CIC y qué ropa llevo?",
      "Restaurantes cerca para comer después de la plenaria",
      "¿Quién es el presidente de la Mesa Directiva?",
      "Resume el programa del miércoles 3 de junio",
    ],
    []
  );

  const sortedThreads = useMemo(
    () => [...threads].sort((a, b) => b.updatedAt - a.updatedAt),
    [threads]
  );

  return (
    <div className={`app ${sidebarOpen ? "sidebar-open" : "sidebar-closed"}`}>
      <aside className="sidebar">
        <div className="sidebar-top">
          <button type="button" className="new-chat" onClick={newChat}>
            + Nueva conversación
          </button>
        </div>
        <nav className="thread-list" aria-label="Conversaciones">
          {sortedThreads.map((t) => (
            <div
              key={t.id}
              className={`thread-item ${t.id === activeId ? "active" : ""}`}
            >
              <button
                type="button"
                className="thread-open"
                onClick={() => setActiveId(t.id)}
              >
                {t.title}
              </button>
              <button
                type="button"
                className="thread-del"
                title="Eliminar"
                onClick={() => deleteChat(t.id)}
              >
                ×
              </button>
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <p className="brand-mini">Asistente CMU 2027</p>
          <p className="muted-mini">Congreso · Clima · Lugares</p>
        </div>
      </aside>

      <div className="stage">
        <header className="topbar">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label="Menú"
          >
            ☰
          </button>
          <div className="topbar-title">
            <h1>
              <span className="brand-prefix">Asistente</span>{" "}
              <span className="brand-cmu">CMU 2027</span>
            </h1>
            <p className="topbar-sub">{active?.title}</p>
          </div>
          <div className="topbar-chips">
            {weatherChip && <span className="chip weather">{weatherChip}</span>}
            {!IS_STATIC && (
              <span className={health?.hasApiKey ? "chip ok" : "chip warn"}>
                {health?.hasApiKey ? "Listo" : "Sin API key"}
              </span>
            )}
          </div>
        </header>

        <div className="conversation" ref={listRef}>
          {active?.messages.map((m) => (
            <article key={m.id} className={`msg ${m.role}`}>
              {m.role !== "user" && (
                <div className="avatar" aria-hidden>
                  {m.role === "assistant" ? "AI" : "i"}
                </div>
              )}
              <div className="msg-main">
                {m.role === "assistant" ? (
                  <>
                    <MarkdownBody text={m.text} streaming={m.streaming} />
                    {!m.streaming && m.text && (
                      <button
                        type="button"
                        className="replay-voice"
                        onClick={() =>
                          void speakSummary(m.text, m.voiceSummary)
                        }
                      >
                        Escuchar resumen
                      </button>
                    )}
                  </>
                ) : (
                  <div
                    className="bubble-body"
                    dangerouslySetInnerHTML={{
                      __html: escapeHtml(m.text).replace(/\n/g, "<br/>"),
                    }}
                  />
                )}
              </div>
            </article>
          ))}
          {busy && (
            <p className="thinking" aria-live="polite">
              Pensando con programa, clima y lugares…
            </p>
          )}
        </div>

        {!IS_STATIC &&
          active &&
          !active.messages.some((m) => m.role === "user") && (
            <div className="prompt-grid">
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

        {error && <p className="error-banner">{error}</p>}

        <form
          className="dock"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <button
            type="button"
            className={`mic ${listening ? "hot" : ""}`}
            onClick={toggleListen}
            disabled={IS_STATIC}
            title="Dictar"
          >
            Mic
          </button>
          <textarea
            value={input}
            disabled={IS_STATIC}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              IS_STATIC
                ? "Chat solo en local / Codespace"
                : "Pregunta sobre el congreso, clima, comida cerca del CIC…"
            }
            rows={2}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
          />
          <div className="dock-actions">
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
              Resumen en voz
            </label>
            <button
              type="submit"
              className="send"
              disabled={IS_STATIC || busy || !input.trim()}
            >
              {busy ? "…" : "Enviar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
