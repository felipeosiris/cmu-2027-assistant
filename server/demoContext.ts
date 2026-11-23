/**
 * Prefetch de notas/programa para el Agent (sigue respondiendo el Agent;
 * esto evita exploraciones largas del filesystem).
 */
import fs from "node:fs";
import path from "node:path";
import { SESSIONS, findSponsors, findSessions } from "./program.js";

function norm(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[¿?¡!.,;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readVault(vaultRoot: string, rel: string, max = 4000): string | null {
  const abs = path.join(vaultRoot, rel);
  try {
    if (!fs.existsSync(abs)) return null;
    return fs
      .readFileSync(abs, "utf8")
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
      .replace(/\[\[([^\]]+)\]\]/g, "$1")
      .trim()
      .slice(0, max);
  } catch {
    return null;
  }
}

function sessionsJson(filter: (s: (typeof SESSIONS)[number]) => boolean) {
  return SESSIONS.filter(filter).slice(0, 12);
}

/**
 * Devuelve bloques markdown relevantes según la pregunta.
 * El Agent los recibe en DATOS EN VIVO y puede responder sin listar todo el vault.
 */
export function prefetchRelevantNotes(
  prompt: string,
  vaultRoot: string
): string[] {
  const q = norm(prompt);
  const parts: string[] = [];

  const pushFile = (title: string, rel: string) => {
    const body = readVault(vaultRoot, rel);
    if (body) parts.push(`## ${title}\n\n${body}`);
  };

  if (/urizia/.test(q)) {
    pushFile("Ficha Urizia (productos)", "Productos/Urizia-ficha.md");
  }

  if (/zerotip|zero tip|canastilla/.test(q)) {
    pushFile("Ficha ZeroTip Boston", "Productos/ZeroTip-Boston.md");
  }

  // "estándar" NO debe activar stands — usar límites de palabra
  if (
    /\bindustria\b|\bstands?\b|\barea comercial\b|\bexposicion\b|\bpasillo [abc]\b|\bdonde esta (boston|astellas|liomont|astrazeneca)\b/.test(
      q
    )
  ) {
    pushFile("Área comercial / stands", "Congreso-2026/Area-comercial-stands.md");
  }

  if (
    /\blhrh\b|\bbicalutamida\b|\bgnrh\b|\banalogos?\b.*lhrh|\bantagonistas?\b.*lhrh/.test(
      q
    )
  ) {
    pushFile(
      "Nota LHRH sin bicalutamida",
      "Congreso-2026/Nota-LHRH-sin-bicalutamida.md"
    );
  }

  if (/astrazeneca|astra zeneca/.test(q)) {
    pushFile(
      "Resumen sesión AstraZeneca",
      "Congreso-2026/Resumen-AstraZeneca-DEMO.md"
    );
    const rows = sessionsJson((s) =>
      (s.sponsor || "").toLowerCase().includes("astrazeneca")
    );
    if (rows.length) {
      parts.push(
        `## Sesiones AstraZeneca (índice)\n\`\`\`json\n${JSON.stringify(rows, null, 2)}\n\`\`\``
      );
    }
  }

  if (/liomont/.test(q)) {
    pushFile("Actividades labs DEMO", "Congreso-2026/Actividades-labs-DEMO.md");
    const rows = sessionsJson((s) =>
      (s.sponsor || "").toLowerCase().includes("liomont")
    );
    parts.push(
      `## Sesiones Liomont (índice)\n\`\`\`json\n${JSON.stringify(rows, null, 2)}\n\`\`\``
    );
    const sp = findSponsors("liomont");
    if (sp.length) {
      parts.push(
        `## Sponsor Liomont\n\`\`\`json\n${JSON.stringify(sp, null, 2)}\n\`\`\``
      );
    }
  }

  if (
    /boston/.test(q) &&
    /(platica|plática|sesion|sesión|ponente|taller|patrocin|zerotip|canastilla)/.test(
      q
    )
  ) {
    const rows = sessionsJson((s) =>
      (s.sponsor || "").toLowerCase().includes("boston")
    );
    parts.push(
      `## Sesiones Boston Scientific (índice)\n\`\`\`json\n${JSON.stringify(rows, null, 2)}\n\`\`\``
    );
    const sp = findSponsors("boston");
    if (sp.length) {
      parts.push(
        `## Sponsor Boston\n\`\`\`json\n${JSON.stringify(sp, null, 2)}\n\`\`\``
      );
    }
  }

  if (
    /astellas/.test(q) ||
    (/cafe|café/.test(q) && /astellas|experto/.test(q))
  ) {
    pushFile("Actividades labs DEMO", "Congreso-2026/Actividades-labs-DEMO.md");
    const rows = sessionsJson((s) =>
      (s.sponsor || "").toLowerCase().includes("astellas")
    );
    parts.push(
      `## Sesiones Astellas (índice)\n\`\`\`json\n${JSON.stringify(rows, null, 2)}\n\`\`\``
    );
  }

  if (
    /robot|laparoscop/.test(q) &&
    /(probar|hands|demo|bahia|bahía|horario|consola)/.test(q)
  ) {
    pushFile("Stands / bahías robots", "Congreso-2026/Area-comercial-stands.md");
    pushFile("Actividades labs DEMO", "Congreso-2026/Actividades-labs-DEMO.md");
    const rows = sessionsJson(
      (s) =>
        /hands-on|bahía r-|bahia r-/i.test(s.title) ||
        (s.tags || []).includes("hands-on")
    );
    parts.push(
      `## Hands-on robots (índice)\n\`\`\`json\n${JSON.stringify(rows, null, 2)}\n\`\`\``
    );
  }

  if (
    /(3 horas|tres horas)/.test(q) ||
    (/(manana|mañana|tarde)/.test(q) &&
      /agenda|sesiones|sugiere|recomienda/.test(q))
  ) {
    pushFile("Actividades labs DEMO", "Congreso-2026/Actividades-labs-DEMO.md");
    const pm = sessionsJson((s) => {
      const h = Number(s.start.slice(0, 2));
      return (
        (s.day === "2026-06-04" || s.day === "2026-06-05") &&
        h >= 13 &&
        h < 18 &&
        s.track !== "Logística" &&
        s.track !== "Social"
      );
    });
    parts.push(
      `## Bloques PM jueves/viernes (índice)\n\`\`\`json\n${JSON.stringify(pm, null, 2)}\n\`\`\``
    );
  }

  // Búsqueda genérica de sesiones si hablan de agenda/programa
  if (
    !parts.length &&
    /(agenda|sesion|sesión|horario|programa|que hay|qué hay)/.test(q)
  ) {
    const hits = findSessions(prompt).slice(0, 8);
    if (hits.length) {
      parts.push(
        `## Sesiones relacionadas\n\`\`\`json\n${JSON.stringify(hits, null, 2)}\n\`\`\``
      );
    }
  }

  return parts;
}
