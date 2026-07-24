import { useEffect, useMemo, useState } from "react";
import { apiUrl } from "./api";

export type ProgramSession = {
  id: string;
  day: string;
  start: string;
  end: string;
  title: string;
  roomId: string;
  track?: string;
  speakers?: string[];
  sponsor?: string;
  room?: { shortName: string; name: string };
};

type AgendaResp = {
  nowIso: string;
  source: string;
  current: ProgramSession[];
  next: Array<ProgramSession & { startsInMin: number }>;
  daySessions: ProgramSession[];
};

const AGENDA_KEY = "cmu-ai-my-agenda-v1";

function loadFavs(): string[] {
  try {
    const raw = localStorage.getItem(AGENDA_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveFavs(ids: string[]) {
  localStorage.setItem(AGENDA_KEY, JSON.stringify(ids));
}

type Props = {
  open: boolean;
  onClose: () => void;
  onAsk: (prompt: string) => void;
};

export function MyAgendaPanel({ open, onClose, onAsk }: Props) {
  const [favIds, setFavIds] = useState<string[]>(() => loadFavs());
  const [agenda, setAgenda] = useState<AgendaResp | null>(null);
  const [allSessions, setAllSessions] = useState<ProgramSession[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const [a, p] = await Promise.all([
          fetch(apiUrl("/api/program/agenda")).then((r) => r.json()),
          fetch(apiUrl("/api/program")).then((r) => r.json()),
        ]);
        if (cancelled) return;
        setAgenda(a);
        setAllSessions(p.sessions || []);
        setErr(null);
      } catch (e) {
        if (!cancelled)
          setErr(e instanceof Error ? e.message : "No se pudo cargar agenda");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const favSessions = useMemo(() => {
    const map = new Map(allSessions.map((s) => [s.id, s]));
    return favIds.map((id) => map.get(id)).filter(Boolean) as ProgramSession[];
  }, [favIds, allSessions]);

  const toggle = (id: string) => {
    setFavIds((prev) => {
      const next = prev.includes(id)
        ? prev.filter((x) => x !== id)
        : [...prev, id];
      saveFavs(next);
      return next;
    });
  };

  const exportAgenda = () => {
    const lines = [
      "Mi agenda — 50° Congreso CMU 2026",
      "",
      ...favSessions.map(
        (s) =>
          `• ${s.day} ${s.start}–${s.end} · ${s.title} · ${s.roomId}${s.sponsor ? ` · ${s.sponsor}` : ""}`
      ),
      "",
      `Exportado: ${new Date().toLocaleString("es-MX")}`,
    ];
    void downloadResponsePdf("Mi agenda CMU 2026", lines.join("\n")).catch(
      console.error
    );
  };

  if (!open) return null;

  return (
    <div className="history-panel agenda-panel" role="dialog" aria-label="Mi agenda">
      <div className="history-head">
        <div>
          <h2>Mi agenda</h2>
          <p className="history-sub">
            {agenda
              ? `Reloj ${agenda.source} · ${agenda.nowIso.slice(0, 16)}`
              : "Cargando…"}
          </p>
        </div>
        <div className="history-actions">
          {favSessions.length > 0 && (
            <button type="button" className="text-btn accent" onClick={exportAgenda}>
              Exportar
            </button>
          )}
          <button type="button" className="text-btn" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>

      {err && <p className="error-line">{err}</p>}

      <div className="history-list">
        <section className="history-group">
          <h3 className="history-group-label">Guardadas ({favSessions.length})</h3>
          {favSessions.length === 0 ? (
            <p className="agenda-empty">
              Marca sesiones con ★ desde “Ahora / Hoy” o pregunta al asistente.
            </p>
          ) : (
            <ul>
              {favSessions.map((s) => (
                <li key={s.id} className="on">
                  <button
                    type="button"
                    className="hist-open"
                    onClick={() =>
                      onAsk(
                        `Detalles de la sesión "${s.title}" el ${s.day} a las ${s.start} en ${s.roomId}`
                      )
                    }
                  >
                    <span className="hist-title">{s.title}</span>
                    <span className="hist-meta">
                      {s.day} · {s.start}–{s.end} · {s.roomId}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="hist-del star on"
                    aria-label="Quitar de mi agenda"
                    onClick={() => toggle(s.id)}
                  >
                    ★
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {agenda && (
          <>
            <section className="history-group">
              <h3 className="history-group-label">En curso</h3>
              <ul>
                {(agenda.current.length ? agenda.current : []).map((s) => (
                  <li key={s.id}>
                    <button type="button" className="hist-open" onClick={() => toggle(s.id)}>
                      <span className="hist-title">{s.title}</span>
                      <span className="hist-meta">
                        {s.start}–{s.end} · {s.room?.shortName || s.roomId}
                      </span>
                    </button>
                    <button
                      type="button"
                      className={`hist-del star ${favIds.includes(s.id) ? "on" : ""}`}
                      onClick={() => toggle(s.id)}
                    >
                      {favIds.includes(s.id) ? "★" : "☆"}
                    </button>
                  </li>
                ))}
                {!agenda.current.length && (
                  <p className="agenda-empty">Nada en curso en este minuto.</p>
                )}
              </ul>
            </section>

            <section className="history-group">
              <h3 className="history-group-label">Siguiente</h3>
              <ul>
                {agenda.next.map((s) => (
                  <li key={s.id}>
                    <button type="button" className="hist-open" onClick={() => toggle(s.id)}>
                      <span className="hist-title">{s.title}</span>
                      <span className="hist-meta">
                        en {s.startsInMin} min · {s.start} · {s.room?.shortName || s.roomId}
                      </span>
                    </button>
                    <button
                      type="button"
                      className={`hist-del star ${favIds.includes(s.id) ? "on" : ""}`}
                      onClick={() => toggle(s.id)}
                    >
                      {favIds.includes(s.id) ? "★" : "☆"}
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            <section className="history-group">
              <h3 className="history-group-label">Hoy (indexado)</h3>
              <ul>
                {agenda.daySessions.slice(0, 12).map((s) => (
                  <li key={s.id}>
                    <button type="button" className="hist-open" onClick={() => toggle(s.id)}>
                      <span className="hist-title">{s.title}</span>
                      <span className="hist-meta">
                        {s.start}–{s.end} · {s.room?.shortName || s.roomId}
                      </span>
                    </button>
                    <button
                      type="button"
                      className={`hist-del star ${favIds.includes(s.id) ? "on" : ""}`}
                      onClick={() => toggle(s.id)}
                    >
                      {favIds.includes(s.id) ? "★" : "☆"}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

export async function downloadResponsePdf(title: string, text: string) {
  const res = await fetch(apiUrl("/api/export/pdf"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, text }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `PDF HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.replace(/[^\w\-]+/g, "_").slice(0, 40) || "cmu-respuesta"}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function shareOrCopy(title: string, text: string) {
  const payload = `${title}\n\n${text}`;
  if (navigator.share) {
    try {
      await navigator.share({ title, text: payload });
      return "shared";
    } catch {
      /* fall through */
    }
  }
  await navigator.clipboard.writeText(payload);
  return "copied";
}
