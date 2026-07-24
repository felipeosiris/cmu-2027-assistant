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
      ? "Vista estática. Para el asistente completo (clima, lugares, voz): cd cmu-ai && npm run dev."
      : "Listo para ayudarte en el 50° Congreso en Puerto Vallarta: programa, ponentes, clima del CIC y dónde comer cerca.",
  };
}

function emptyThread(): ChatThread {
  return {
    id: uid(),
    title: "Consulta nueva",
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
  return t.length > 36 ? `${t.slice(0, 36)}…` : t || "Consulta nueva";
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
    const clean = (summaryHint || text)
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 280);
    if (!clean || !window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = "es-MX";
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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [weather, setWeather] = useState<{
    temperatureC: number;
    condition: string;
    clothingTip: string;
  } | null>(null);
  const [health, setHealth] = useState<{ hasApiKey?: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const inputRef = useRef(input);
  inputRef.current = input;

  const active = threads.find((t) => t.id === activeId) || threads[0];
  const hasUserMsgs = !!active?.messages.some((m) => m.role === "user");

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
        if (w?.temperatureC != null) setWeather(w);
      })
      .catch(() => null);
    window.speechSynthesis?.getVoices();
  }, []);

  useEffect(() => {
    feedRef.current?.scrollTo({
      top: feedRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [active?.messages, busy]);

  const patchActive = useCallback(
    (fn: (t: ChatThread) => ChatThread) => {
      setThreads((all) =>
        all.map((t) =>
          t.id === activeId ? fn({ ...t, updatedAt: Date.now() }) : t
        )
      );
    },
    [activeId]
  );

  const newChat = () => {
    const t = emptyThread();
    setThreads((all) => [t, ...all]);
    setActiveId(t.id);
    setError(null);
    setHistoryOpen(false);
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
      setHistoryOpen(false);

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
            patchActive((t) => ({
              ...t,
              agentSessionId: parsed.sessionId as string,
            }));
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
      setError("Usa Chrome para dictado por voz.");
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
      {
        label: "Clima y vestimenta",
        prompt: "¿Qué clima hay ahora en el CIC y qué ropa llevo a la siguiente sesión?",
      },
      {
        label: "Comer cerca",
        prompt: "Recomiéndame restaurantes cerca del CIC para después de una plenaria",
      },
      {
        label: "Mesa Directiva",
        prompt: "¿Quién integra la Mesa Directiva CMUN y quién es el presidente?",
      },
      {
        label: "Miércoles 3",
        prompt: "Resume el programa del miércoles 3 de junio del 50° Congreso",
      },
    ],
    []
  );

  const sortedThreads = useMemo(
    () => [...threads].sort((a, b) => b.updatedAt - a.updatedAt),
    [threads]
  );

  return (
    <div className="shell">
      <div className="atmosphere" aria-hidden />
      <img
        className="seal-watermark"
        src="/cmu-seal.png"
        alt=""
        aria-hidden
      />

      <header className="masthead">
        <div className="masthead-brand">
          <img
            className="logo-lockup"
            src="/cmu-logo-lockup.png"
            alt="Colegio Mexicano de Urología Nacional"
          />
          <div className="product-line">
            <span className="product-name">Asistente del Congreso</span>
            <span className="product-edition">50° CMU · Puerto Vallarta 2026</span>
          </div>
        </div>
        <div className="masthead-meta">
          {weather && (
            <div className="insight" title={weather.clothingTip}>
              <span className="insight-k">CIC ahora</span>
              <span className="insight-v">
                {Math.round(weather.temperatureC)}° · {weather.condition}
              </span>
            </div>
          )}
          <button
            type="button"
            className="ghost-btn"
            onClick={() => setHistoryOpen((v) => !v)}
          >
            Consultas
          </button>
          <button type="button" className="ghost-btn primary-ghost" onClick={newChat}>
            Nueva
          </button>
        </div>
      </header>

      {historyOpen && (
        <div className="history-panel" role="dialog" aria-label="Consultas">
          <div className="history-head">
            <h2>Tus consultas</h2>
            <button type="button" className="text-btn" onClick={() => setHistoryOpen(false)}>
              Cerrar
            </button>
          </div>
          <ul>
            {sortedThreads.map((t) => (
              <li key={t.id} className={t.id === activeId ? "on" : ""}>
                <button
                  type="button"
                  className="hist-open"
                  onClick={() => {
                    setActiveId(t.id);
                    setHistoryOpen(false);
                  }}
                >
                  {t.title}
                </button>
                <button
                  type="button"
                  className="hist-del"
                  onClick={() => deleteChat(t.id)}
                  aria-label="Eliminar"
                >
                  Eliminar
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <main className="workspace">
        {!hasUserMsgs ? (
          <section className="landing">
            <img className="landing-seal" src="/cmu-seal.png" alt="" />
            <h1 className="landing-title">
              Tu guía en el
              <br />
              <em>Congreso CMU</em>
            </h1>
            <p className="landing-lede">
              Programa, ponentes, clima en el CIC y lugares para comer — en una
              sola consulta.
            </p>
            {!IS_STATIC && (
              <div className="action-rail">
                {suggestions.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    className="action-tile"
                    disabled={busy}
                    onClick={() => void send(s.prompt)}
                  >
                    <span className="tile-label">{s.label}</span>
                    <span className="tile-prompt">{s.prompt}</span>
                  </button>
                ))}
              </div>
            )}
            {IS_STATIC && (
              <p className="landing-note">
                Esta vista pública es solo presentación. El asistente completo
                corre en local o Codespace.
              </p>
            )}
          </section>
        ) : (
          <section className="briefings" ref={feedRef}>
            {active?.messages
              .filter((m) => m.role !== "system")
              .map((m) => (
                <article key={m.id} className={`briefing ${m.role}`}>
                  <header className="briefing-head">
                    <span className="briefing-who">
                      {m.role === "user" ? "Tu consulta" : "Asistente CMU"}
                    </span>
                    {m.role === "assistant" && !m.streaming && m.text && (
                      <button
                        type="button"
                        className="text-btn"
                        onClick={() =>
                          void speakSummary(m.text, m.voiceSummary)
                        }
                      >
                        Escuchar resumen
                      </button>
                    )}
                  </header>
                  {m.role === "assistant" ? (
                    <MarkdownBody text={m.text} streaming={m.streaming} />
                  ) : (
                    <p
                      className="user-query"
                      dangerouslySetInnerHTML={{
                        __html: escapeHtml(m.text).replace(/\n/g, "<br/>"),
                      }}
                    />
                  )}
                </article>
              ))}
            {busy && (
              <p className="status-line">Consultando programa, clima y lugares…</p>
            )}
          </section>
        )}
      </main>

      {error && <p className="error-line">{error}</p>}

      <footer className="command">
        <div className="command-inner">
          <button
            type="button"
            className={`cmd-mic ${listening ? "hot" : ""}`}
            onClick={toggleListen}
            disabled={IS_STATIC}
            title="Dictar"
          >
            {listening ? "…" : "Mic"}
          </button>
          <textarea
            value={input}
            disabled={IS_STATIC}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Escribe tu consulta al asistente CMU…"
            rows={1}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
          />
          <label className="cmd-voice">
            <input
              type="checkbox"
              checked={voiceOut}
              disabled={IS_STATIC}
              onChange={(e) => {
                setVoiceOut(e.target.checked);
                if (!e.target.checked) window.speechSynthesis?.cancel();
              }}
            />
            Voz
          </label>
          <button
            type="button"
            className="cmd-send"
            disabled={IS_STATIC || busy || !input.trim()}
            onClick={() => void send(input)}
          >
            Consultar
          </button>
        </div>
        <p className="cmd-footnote">
          Colegio Mexicano de Urología Nacional · Asistente del 50° Congreso
          {!IS_STATIC && health?.hasApiKey === false && " · Falta CURSOR_API_KEY"}
        </p>
      </footer>
    </div>
  );
}
