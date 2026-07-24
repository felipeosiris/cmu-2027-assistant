import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MarkdownBody } from "./MarkdownBody";
import { PlaceMaps, type PlaceCard } from "./PlaceMaps";
import {
  MyAgendaPanel,
  downloadResponsePdf,
  shareOrCopy,
} from "./MyAgenda";
import { apiUrl, IS_STATIC } from "./api";

type Role = "user" | "assistant" | "system";

type Msg = {
  id: string;
  role: Role;
  text: string;
  streaming?: boolean;
  voiceSummary?: string;
  places?: PlaceCard[];
  venue?: PlaceCard | null;
};

type ChatThread = {
  id: string;
  title: string;
  agentSessionId: string | null;
  messages: Msg[];
  updatedAt: number;
};

type Suggestion = { label: string; prompt: string; topics: string[] };

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

const STORAGE_KEY = "cmu-ai-threads-v1";

const SUGGESTION_BANK: Suggestion[] = [
  {
    label: "Ahora / siguiente",
    prompt: "¿Qué hay ahora en el congreso y qué sigue en los próximos 30 minutos?",
    topics: ["agenda", "programa"],
  },
  {
    label: "Salones CIC",
    prompt: "¿Cuáles son los salones del CIC y qué se imparte en Maito y Caletas?",
    topics: ["salones", "programa"],
  },
  {
    label: "Patrocinadores",
    prompt: "Lista patrocinadores Oro y Plata y qué actividad tiene Astellas",
    topics: ["sponsors"],
  },
  {
    label: "Ficha Sotelo",
    prompt: "Dame la ficha del ponente René Sotelo Noguera y en qué horario habla",
    topics: ["personas", "programa"],
  },
  {
    label: "Clima y ropa",
    prompt: "¿Qué clima hay ahora en el CIC y qué ropa me conviene?",
    topics: ["clima", "ropa"],
  },
  {
    label: "Comer cerca",
    prompt: "Recomiéndame 4 restaurantes cerca del CIC con buen rating",
    topics: ["comida"],
  },
  {
    label: "Café rápido",
    prompt: "¿Dónde tomo un café rápido cerca del CIC entre sesiones?",
    topics: ["comida", "receso"],
  },
  {
    label: "Cómo llegar al CIC",
    prompt: "¿Dónde queda el CIC y cómo llego? Muéstrame el mapa",
    topics: ["sede", "mapa"],
  },
  {
    label: "Hotel cerca",
    prompt: "Recomiéndame 3 hoteles cerca del CIC con buen rating",
    topics: ["hotel"],
  },
  {
    label: "Estacionamiento",
    prompt: "¿Dónde puedo estacionar cerca del CIC?",
    topics: ["parking"],
  },
  {
    label: "Farmacia",
    prompt: "¿Hay farmacia cerca del CIC por si necesito algo urgente?",
    topics: ["farmacia"],
  },
  {
    label: "Urgencias",
    prompt: "¿Cuál es el hospital o urgencias más cerca del CIC?",
    topics: ["urgencia"],
  },
  {
    label: "Cajero ATM",
    prompt: "¿Dónde hay cajero automático cerca del CIC?",
    topics: ["cajero"],
  },
  {
    label: "Mesa Directiva",
    prompt: "¿Quién es el presidente y quién integra la Mesa Directiva CMUN?",
    topics: ["mesa", "personas"],
  },
  {
    label: "Programa hoy",
    prompt: "Resume el programa del día más relevante del 50° Congreso",
    topics: ["programa"],
  },
  {
    label: "Miércoles 3",
    prompt: "¿Qué hay el miércoles 3 de junio? Destaca uropediatría y andrología",
    topics: ["programa", "miercoles"],
  },
  {
    label: "Jueves 4",
    prompt: "Resume el jueves 4: HPB, cáncer vesical y renal",
    topics: ["programa", "jueves"],
  },
  {
    label: "Viernes 5",
    prompt: "¿Qué ver el viernes 5 de junio sobre endourología y próstata?",
    topics: ["programa", "viernes"],
  },
  {
    label: "Innovation Hub",
    prompt: "Explícame el Innovation Hub del plan estratégico CMU 2027",
    topics: ["plan"],
  },
  {
    label: "Monetización",
    prompt: "Resume el modelo de monetización del plan CMU 2027",
    topics: ["plan"],
  },
  {
    label: "Ponente internacional",
    prompt: "¿Qué ponentes internacionales destacan y de qué hablan?",
    topics: ["personas", "programa"],
  },
  {
    label: "Tras una plenaria",
    prompt: "Acabo de salir de una plenaria: clima, ropa y dónde comer cerca",
    topics: ["clima", "comida", "receso"],
  },
  {
    label: "Próxima sesión",
    prompt: "Ayúdame a prepararme para la siguiente sesión: tema, ponente y tips",
    topics: ["programa", "personas"],
  },
  {
    label: "Asistente IA del plan",
    prompt: "Dame ejemplos de uso del Asistente IA del congreso según la bóveda",
    topics: ["plan", "ia"],
  },
];

function detectTopics(text: string): string[] {
  const t = text.toLowerCase();
  const found: string[] = [];
  if (/clima|temperatura|calor|fr[ií]o|ropa|paraguas|vestir/.test(t))
    found.push("clima", "ropa");
  if (/ahora|siguiente|agenda|horario|programa/.test(t))
    found.push("agenda", "programa");
  if (/sal[oó]n|maito|quimixto|caletas|majahuitas/.test(t))
    found.push("salones", "programa");
  if (/patrocin|sponsor|astellas|oro|plata|bronce/.test(t))
    found.push("sponsors");
  if (/restaurante|comer|comida|cenar|caf[eé]|almorz/.test(t))
    found.push("comida");
  if (/c[ií]c|sede|llegar|ubicaci[oó]n|mapa/.test(t)) found.push("sede", "mapa");
  if (/hotel|hospedaje|dormir/.test(t)) found.push("hotel");
  if (/estacionamiento|parking|aparcar|coche|auto/.test(t))
    found.push("parking");
  if (/farmacia|medicamento/.test(t)) found.push("farmacia");
  if (/hospital|urgencia|emergencia/.test(t)) found.push("urgencia");
  if (/cajero|atm|efectivo/.test(t)) found.push("cajero");
  if (/mesa|presidente|directiva|hern[aá]ndez|porras/.test(t))
    found.push("mesa", "personas");
  if (/programa|junio|plenaria|sesi[oó]n|curso|horario/.test(t))
    found.push("programa");
  if (/mi[eé]rcoles|3 de junio/.test(t)) found.push("miercoles");
  if (/jueves|4 de junio/.test(t)) found.push("jueves");
  if (/viernes|5 de junio/.test(t)) found.push("viernes");
  if (/ponente|dr\.|dra\.|palou|sotelo|denstedt|reiter/.test(t))
    found.push("personas");
  if (/monetiz|innovaci[oó]n|estrat[eé]gic|plataforma 365|visi[oó]n/.test(t))
    found.push("plan");
  if (/receso|hueco|break|despu[eé]s de/.test(t)) found.push("receso");
  return [...new Set(found)];
}

function pickSuggestions(history: string[], limit = 4): Suggestion[] {
  const asked = history.join("\n").toLowerCase();
  const topics = history.flatMap(detectTopics);
  const topicCount = topics.reduce<Record<string, number>>((acc, t) => {
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});

  const scored = SUGGESTION_BANK.map((s, i) => {
    const already =
      asked.includes(s.prompt.slice(0, 28).toLowerCase()) ||
      history.some((h) => h.toLowerCase().includes(s.label.toLowerCase()));
    if (already) return { s, score: -100 };

    let score = 1;
    for (const t of s.topics) {
      if (topicCount[t]) score += 3 * topicCount[t];
      else score += 0.5; // explore related
    }
    // diversify: boost topics not yet covered
    const uncovered = s.topics.every((t) => !topicCount[t]);
    if (history.length && uncovered) score += 4;
    // rotate with time so it feels alive
    score += (Date.now() / 60000 + i) % 3;
    return { s, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.s);
}

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
      ? "Vista estática. Para el asistente completo: cd cmu-ai && npm run dev."
      : "Listo para el 50° Congreso en Puerto Vallarta.",
  };
}

function emptyThread(): ChatThread {
  return {
    id: uid(),
    title: "Nueva sesión",
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
  return t.length > 42 ? `${t.slice(0, 42)}…` : t || "Nueva sesión";
}

function sessionMeta(t: ChatThread) {
  const msgs = t.messages.filter((m) => m.role !== "system");
  const turns = msgs.filter((m) => m.role === "user").length;
  const preview =
    [...msgs].reverse().find((m) => m.role === "assistant" && m.text)?.text ||
    [...msgs].reverse().find((m) => m.role === "user")?.text ||
    "Sin mensajes aún";
  const clean = preview.replace(/\s+/g, " ").trim();
  return {
    turns,
    preview: clean.length > 72 ? `${clean.slice(0, 72)}…` : clean,
  };
}

function relativeWhen(ts: number) {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "Ahora";
  if (min < 60) return `Hace ${min} min`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `Hace ${hrs} h`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Ayer";
  if (days < 7) return `Hace ${days} días`;
  return new Date(ts).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
  });
}

function sessionBucket(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startYesterday = startToday - 86400000;
  if (ts >= startToday) return "Hoy";
  if (ts >= startYesterday) return "Ayer";
  if (ts >= startToday - 7 * 86400000) return "Esta semana";
  return "Anteriores";
}

async function speakSummary(text: string, summaryHint?: string) {
  window.speechSynthesis?.cancel();
  try {
    const res = await fetch(apiUrl("/api/speak"), {
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
  const [agendaOpen, setAgendaOpen] = useState(false);
  const [shareHint, setShareHint] = useState<string | null>(null);
  const [weather, setWeather] = useState<{
    temperatureC: number;
    condition: string;
    clothingTip: string;
  } | null>(null);
  const [health, setHealth] = useState<{ hasApiKey?: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const feedRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const inputRef = useRef(input);
  inputRef.current = input;

  const active = threads.find((t) => t.id === activeId) || threads[0];
  const hasUserMsgs = !!active?.messages.some((m) => m.role === "user");
  const userPrompts =
    active?.messages.filter((m) => m.role === "user").map((m) => m.text) || [];

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(threads));
  }, [threads]);

  useEffect(() => {
    if (IS_STATIC) return;
    fetch(apiUrl("/api/health"))
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth(null));
    fetch(apiUrl("/api/tools/weather"))
      .then((r) => r.json())
      .then((w) => {
        if (w?.temperatureC != null) setWeather(w);
      })
      .catch(() => null);
    window.speechSynthesis?.getVoices();
  }, []);

  // Refresh suggestion rotation periodically on landing
  useEffect(() => {
    if (hasUserMsgs) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 45000);
    return () => clearInterval(id);
  }, [hasUserMsgs]);

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
        const res = await fetch(apiUrl("/api/chat"), {
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
        let places: PlaceCard[] = [];
        let venue: PlaceCard | null = null;

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
          if (event === "places") {
            if (Array.isArray(parsed.places)) {
              places = parsed.places as PlaceCard[];
            }
            if (parsed.venue && typeof parsed.venue === "object") {
              venue = parsed.venue as PlaceCard;
            }
            patchActive((t) => ({
              ...t,
              messages: t.messages.map((msg) =>
                msg.id === assistantId
                  ? { ...msg, places, venue, text: full, streaming: true }
                  : msg
              ),
            }));
          }
          if (event === "delta" && typeof parsed.text === "string") {
            full += parsed.text;
            patchActive((t) => ({
              ...t,
              messages: t.messages.map((msg) =>
                msg.id === assistantId
                  ? { ...msg, text: full, places, venue, streaming: true }
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
                      places,
                      venue,
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

  const suggestions = useMemo(() => {
    void tick;
    return pickSuggestions(userPrompts, 4);
  }, [userPrompts, tick, activeId]);

  const sortedThreads = useMemo(
    () => [...threads].sort((a, b) => b.updatedAt - a.updatedAt),
    [threads]
  );

  const sessionGroups = useMemo(() => {
    const order = ["Hoy", "Ayer", "Esta semana", "Anteriores"];
    const map = new Map<string, ChatThread[]>();
    for (const t of sortedThreads) {
      const b = sessionBucket(t.updatedAt);
      if (!map.has(b)) map.set(b, []);
      map.get(b)!.push(t);
    }
    return order
      .filter((k) => map.has(k))
      .map((label) => ({ label, items: map.get(label)! }));
  }, [sortedThreads]);

  return (
    <div className="shell">
      <div className="atmosphere" aria-hidden />

      <header className="masthead">
        <div className="masthead-brand">
          <img
            className="logo-seal"
            src="/cmu-seal.png?v=3"
            alt=""
            width={52}
            height={52}
          />
          <div className="wordmark">
            <span className="wm-small">Colegio Mexicano de</span>
            <span className="wm-strong">Urología Nacional</span>
            <span className="wm-product">Asistente · 50° Congreso 2026</span>
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
            onClick={() => {
              setAgendaOpen((v) => !v);
              setHistoryOpen(false);
            }}
          >
            Mi agenda
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => {
              setHistoryOpen((v) => !v);
              setAgendaOpen(false);
            }}
          >
            Sesiones
          </button>
          <button
            type="button"
            className="ghost-btn primary-ghost"
            onClick={newChat}
          >
            Nueva
          </button>
        </div>
      </header>

      <MyAgendaPanel
        open={agendaOpen}
        onClose={() => setAgendaOpen(false)}
        onAsk={(p) => {
          setAgendaOpen(false);
          void send(p);
        }}
      />

      {historyOpen && (
        <div className="history-panel" role="dialog" aria-label="Sesiones">
          <div className="history-head">
            <div>
              <h2>Sesiones</h2>
              <p className="history-sub">
                {sortedThreads.length} conversación
                {sortedThreads.length === 1 ? "" : "es"}
              </p>
            </div>
            <div className="history-actions">
              <button
                type="button"
                className="text-btn accent"
                onClick={() => {
                  newChat();
                  setHistoryOpen(false);
                }}
              >
                Nueva sesión
              </button>
              <button
                type="button"
                className="text-btn"
                onClick={() => setHistoryOpen(false)}
                aria-label="Cerrar"
              >
                Cerrar
              </button>
            </div>
          </div>
          <div className="history-list">
            {sessionGroups.map((group) => (
              <section key={group.label} className="history-group">
                <h3 className="history-group-label">{group.label}</h3>
                <ul>
                  {group.items.map((t) => {
                    const meta = sessionMeta(t);
                    return (
                      <li key={t.id} className={t.id === activeId ? "on" : ""}>
                        <button
                          type="button"
                          className="hist-open"
                          onClick={() => {
                            setActiveId(t.id);
                            setHistoryOpen(false);
                          }}
                        >
                          <span className="hist-title">{t.title}</span>
                          <span className="hist-preview">{meta.preview}</span>
                          <span className="hist-meta">
                            <span>{relativeWhen(t.updatedAt)}</span>
                            <span>·</span>
                            <span>
                              {meta.turns} mensaje
                              {meta.turns === 1 ? "" : "s"}
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          className="hist-del"
                          aria-label="Eliminar sesión"
                          title="Eliminar sesión"
                          onClick={() => deleteChat(t.id)}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path
                              fill="currentColor"
                              d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"
                            />
                          </svg>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </div>
      )}

      <main className="workspace">
        {!hasUserMsgs ? (
          <section className="landing">
            <h1 className="landing-title">
              Tu guía en el
              <br />
              <em>Congreso CMU</em>
            </h1>
            <p className="landing-lede">
              Las sugerencias cambian según lo que vas preguntando.
            </p>
            {!IS_STATIC && (
              <div className="action-rail">
                {suggestions.map((s) => (
                  <button
                    key={s.label + s.prompt}
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
                  </header>
                  {m.role === "assistant" ? (
                    <>
                      <MarkdownBody text={m.text} streaming={m.streaming} />
                      {(m.places?.length || m.venue) && (
                        <PlaceMaps
                          places={m.places || []}
                          venue={m.venue}
                        />
                      )}
                      {!m.streaming && m.text && (
                        <div className="msg-actions">
                          <button
                            type="button"
                            onClick={() => {
                              void downloadResponsePdf(
                                "Respuesta Asistente CMU",
                                m.text
                              ).catch((e) =>
                                setError(
                                  e instanceof Error
                                    ? e.message
                                    : "No se pudo generar PDF"
                                )
                              );
                            }}
                          >
                            Descargar PDF
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              void shareOrCopy(
                                "Asistente CMU",
                                m.text
                              ).then((r) =>
                                setShareHint(
                                  r === "shared" ? "Compartido" : "Copiado"
                                )
                              );
                              setTimeout(() => setShareHint(null), 2000);
                            }}
                          >
                            Compartir
                          </button>
                        </div>
                      )}
                    </>
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
            {!busy && !IS_STATIC && (
              <div className="next-up">
                <p className="next-up-label">Sugerido para ti</p>
                <div className="next-up-row">
                  {suggestions.slice(0, 3).map((s) => (
                    <button
                      key={s.label}
                      type="button"
                      disabled={busy}
                      onClick={() => void send(s.prompt)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {busy && (
              <p className="status-line">
                Consultando programa, clima y lugares…
              </p>
            )}
          </section>
        )}
      </main>

      {error && <p className="error-line">{error}</p>}
      {shareHint && <p className="share-hint">{shareHint}</p>}

      <footer className="app-dock">
        <div className="dock-bar">
          <button
            type="button"
            className={`dock-icon-btn dock-mic ${listening ? "hot" : ""}`}
            onClick={toggleListen}
            disabled={IS_STATIC}
            aria-label={listening ? "Detener micrófono" : "Hablar"}
            title={listening ? "Detener" : "Hablar"}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"
              />
            </svg>
          </button>
          <div className="dock-field">
            <textarea
              value={input}
              disabled={IS_STATIC}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Escribe o dicta tu consulta…"
              rows={1}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
            />
          </div>
          <button
            type="button"
            className={`dock-icon-btn dock-speaker ${voiceOut ? "on" : ""}`}
            disabled={IS_STATIC}
            aria-label={voiceOut ? "Silenciar voz" : "Activar voz"}
            title={voiceOut ? "Voz activada" : "Voz desactivada"}
            onClick={() => {
              const next = !voiceOut;
              setVoiceOut(next);
              if (!next) window.speechSynthesis?.cancel();
            }}
          >
            {voiceOut ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4.03v8.05A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06a9 9 0 0 0 0-17.54z"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M16.5 12a4.5 4.5 0 0 0-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a9 9 0 0 0 3.69-1.81L19.73 21 21 19.73 4.27 3zM12 4 9.91 6.09 12 8.18V4z"
                />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="dock-icon-btn dock-send"
            disabled={IS_STATIC || busy || !input.trim()}
            aria-label="Enviar"
            title="Enviar"
            onClick={() => void send(input)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z"
              />
            </svg>
          </button>
        </div>
        {!IS_STATIC && health?.hasApiKey === false && (
          <p className="dock-note">Falta CURSOR_API_KEY en .env</p>
        )}
      </footer>
    </div>
  );
}
