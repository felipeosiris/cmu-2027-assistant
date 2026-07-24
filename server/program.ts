/**
 * Programa estructurado 50° Congreso CMU 2026 + salones + patrocinadores.
 * Fuente: PDF oficial + notas Congreso-2026/. Horarios aproximados por bloque.
 */

export type RoomId =
  | "maito"
  | "quimixto"
  | "caletas"
  | "majahuitas"
  | "cic-general"
  | "hospital-33"
  | "hosp-nuevo-vallarta"
  | "el-tigre"
  | "externo";

export type Room = {
  id: RoomId;
  name: string;
  shortName: string;
  venue: string;
  tip: string;
};

export type SponsorTier = "oro" | "plata" | "bronce" | "medical-plus" | "actividad";

export type Sponsor = {
  name: string;
  tier: SponsorTier;
  activities?: string[];
  notes?: string;
};

export type ProgramSession = {
  id: string;
  day: string; // YYYY-MM-DD
  start: string; // HH:mm
  end: string;
  title: string;
  roomId: RoomId;
  track?: string;
  speakers?: string[];
  coordinators?: string[];
  sponsor?: string;
  tags?: string[];
};

export const CONGRESS = {
  name: "50° Congreso CMU 2026",
  timezone: "America/Mexico_City",
  startDate: "2026-06-02",
  endDate: "2026-06-06",
  venue: "Centro Internacional de Convenciones de Puerto Vallarta (CIC)",
  /** Reloj demo si estamos fuera del congreso (ISO local PV). */
  demoNow: "2026-06-04T10:20:00",
} as const;

export const ROOMS: Room[] = [
  {
    id: "maito",
    name: "Salón Maito",
    shortName: "Maito",
    venue: "CIC Puerto Vallarta",
    tip: "Uno de los salones principales del CIC; suele albergar cursos, simposios y sesiones clínicas.",
  },
  {
    id: "quimixto",
    name: "Salón Quimixto",
    shortName: "Quimixto",
    venue: "CIC Puerto Vallarta",
    tip: "Salón CIC para reuniones seccionales, NLP/URS, cáncer vesical y simposios.",
  },
  {
    id: "caletas",
    name: "Salón Caletas",
    shortName: "Caletas",
    venue: "CIC Puerto Vallarta",
    tip: "Video teatro (robótica / endourología) y reuniones académicas.",
  },
  {
    id: "majahuitas",
    name: "Salón Majahuitas",
    shortName: "Majahuitas",
    venue: "CIC Puerto Vallarta",
    tip: "Andrología, dermatología urológica, desayunos con el experto y asamblea.",
  },
  {
    id: "cic-general",
    name: "CIC (áreas comunes / comercial)",
    shortName: "CIC",
    venue: "CIC Puerto Vallarta",
    tip: "Registro, área comercial, inauguración, cóctel y cena de clausura.",
  },
  {
    id: "hospital-33",
    name: "Hospital 33 IMSS",
    shortName: "Hosp. 33",
    venue: "Puerto Vallarta (externo)",
    tip: "Curso hands-on HoLEP / ThuLEP (pre-congreso).",
  },
  {
    id: "hosp-nuevo-vallarta",
    name: "Hospital Nuevo Vallarta",
    shortName: "Hosp. N. Vallarta",
    venue: "Nuevo Vallarta (externo)",
    tip: "Curso de biopsia de próstata (trans-congreso).",
  },
  {
    id: "el-tigre",
    name: "Campo de golf El Tigre",
    shortName: "El Tigre",
    venue: "Nuevo Vallarta",
    tip: "Torneo de golf del congreso (2 de junio).",
  },
];

export const SPONSORS: Sponsor[] = [
  {
    name: "Liomont",
    tier: "oro",
    notes: "Patrocinador Oro (logos programa PDF).",
  },
  {
    name: "Senosiain",
    tier: "oro",
    notes: "Patrocinador Oro.",
  },
  {
    name: "Siegfried Rhein",
    tier: "oro",
    notes: "Patrocinador Oro.",
  },
  {
    name: "Johnson & Johnson Innovative Medicine",
    tier: "plata",
  },
  {
    name: "Global Care Products",
    tier: "plata",
  },
  {
    name: "PiSA Farmacéutica",
    tier: "plata",
  },
  {
    name: "AstraZeneca",
    tier: "plata",
  },
  {
    name: "Boston Scientific",
    tier: "plata",
    activities: [
      "Taller: terapia de vapor en HBP (jueves 4) · Quimixto",
    ],
  },
  {
    name: "Endoscopia Guadalajara",
    tier: "plata",
  },
  {
    name: "Megalabs",
    tier: "bronce",
  },
  {
    name: "Grünenthal",
    tier: "bronce",
  },
  {
    name: "Exeltis",
    tier: "bronce",
  },
  {
    name: "ASAC México",
    tier: "bronce",
    activities: [
      "Desayuno con el experto IPI ASAC · inmunidad uroepitelio (jueves 4) · Maito",
    ],
  },
  {
    name: "TENA",
    tier: "bronce",
    activities: [
      "Desayuno con el experto · continencia (jueves 4) · Majahuitas",
    ],
  },
  {
    name: "Astellas",
    tier: "actividad",
    activities: [
      "Martes 2 · 11:00–13:00 · Cáncer de próstata avanzado · Maito",
      "Miércoles 3 · Simposio Astellas · actualización NCCN (Héctor Manuel Sánchez López)",
    ],
    notes: "Patrocinio de sesiones clínicas (no aparece como Oro/Plata/Bronce en logos).",
  },
  {
    name: "Silanes",
    tier: "medical-plus",
    activities: ["Viernes 5 · Simposio Silanes · Ana Silvia Vidal Brant"],
  },
  {
    name: "Bayer",
    tier: "medical-plus",
  },
  {
    name: "Siemens Healthineers",
    tier: "medical-plus",
  },
  {
    name: "SaludDigna",
    tier: "medical-plus",
  },
];

/** Sesiones clave indexadas (bloques útiles para “ahora / siguiente”). */
export const SESSIONS: ProgramSession[] = [
  // Martes 2
  {
    id: "2026-06-02-holep",
    day: "2026-06-02",
    start: "08:00",
    end: "17:00",
    title: "Curso pre-congreso HoLEP / ThuLEP",
    roomId: "hospital-33",
    track: "Pre-congreso",
    tags: ["hbp", "laser", "hands-on"],
  },
  {
    id: "2026-06-02-infecciones",
    day: "2026-06-02",
    start: "08:00",
    end: "17:00",
    title: "Manejo avanzado de infecciones",
    roomId: "maito",
    track: "Pre-congreso",
    tags: ["infecciones"],
  },
  {
    id: "2026-06-02-dermato",
    day: "2026-06-02",
    start: "07:00",
    end: "10:20",
    title: "Dermatología urológica",
    roomId: "majahuitas",
    track: "Pre-congreso",
  },
  {
    id: "2026-06-02-andrologia-am",
    day: "2026-06-02",
    start: "08:00",
    end: "09:00",
    title: "Andrología (pre-congreso)",
    roomId: "majahuitas",
    track: "Andrología",
  },
  {
    id: "2026-06-02-astellas",
    day: "2026-06-02",
    start: "11:00",
    end: "13:00",
    title: "Cáncer de próstata avanzado",
    roomId: "maito",
    track: "Oncología",
    sponsor: "Astellas",
    tags: ["prostata", "oncologia", "astellas"],
  },
  {
    id: "2026-06-02-registro",
    day: "2026-06-02",
    start: "13:00",
    end: "20:00",
    title: "Registro de congresistas y acompañantes",
    roomId: "cic-general",
    track: "Logística",
  },
  {
    id: "2026-06-02-jalisco",
    day: "2026-06-02",
    start: "13:00",
    end: "14:00",
    title: "Reunión Colegio Jaliscience de Urología",
    roomId: "quimixto",
    track: "Reuniones",
  },
  {
    id: "2026-06-02-qro",
    day: "2026-06-02",
    start: "13:30",
    end: "15:40",
    title: "Sociedad Urológica de Querétaro — HoLEP vs ThuFLEP",
    roomId: "caletas",
    track: "Reuniones",
    tags: ["hbp", "laser"],
  },
  {
    id: "2026-06-02-golf",
    day: "2026-06-02",
    start: "07:00",
    end: "14:00",
    title: "Torneo de golf",
    roomId: "el-tigre",
    track: "Social",
  },

  // Miércoles 3
  {
    id: "2026-06-03-registro",
    day: "2026-06-03",
    start: "07:00",
    end: "16:00",
    title: "Registro",
    roomId: "cic-general",
    track: "Logística",
  },
  {
    id: "2026-06-03-uropediatria",
    day: "2026-06-03",
    start: "08:00",
    end: "10:30",
    title: "Uropediatría",
    roomId: "maito",
    track: "Uropediatría",
    speakers: ["Tiago Rosito", "Celeste Alston"],
    coordinators: ["Karina Meza Ocaña", "Carolina Rojas Ramírez"],
    tags: ["pediatria"],
  },
  {
    id: "2026-06-03-andrologia",
    day: "2026-06-03",
    start: "10:00",
    end: "13:15",
    title: "Andrología — prótesis, medicina sexual, IA robótica",
    roomId: "cic-general",
    track: "Andrología",
    speakers: [
      "Alejandro Carvajal Obando",
      "Alysa Yee",
      "René Sotelo Noguera",
    ],
    tags: ["andrologia", "robotica"],
  },
  {
    id: "2026-06-03-sotelo-rescate",
    day: "2026-06-03",
    start: "11:15",
    end: "11:45",
    title:
      "Prostatectomía radical de rescate en escenarios complejos (estenosis / fístulas)",
    roomId: "cic-general",
    track: "Plenaria",
    speakers: ["René Sotelo Noguera"],
    tags: ["prostata", "robotica"],
  },
  {
    id: "2026-06-03-sotelo-ia",
    day: "2026-06-03",
    start: "11:45",
    end: "12:15",
    title: "IA en cirugía robótica: complicaciones",
    roomId: "cic-general",
    track: "Plenaria",
    speakers: ["René Sotelo Noguera"],
    tags: ["ia", "robotica"],
  },
  {
    id: "2026-06-03-astellas",
    day: "2026-06-03",
    start: "12:15",
    end: "13:15",
    title: "Simposio Astellas — actualización NCCN",
    roomId: "cic-general",
    track: "Simposio",
    speakers: ["Héctor Manuel Sánchez López"],
    sponsor: "Astellas",
    tags: ["astellas", "prostata", "nccn"],
  },
  {
    id: "2026-06-03-comercial",
    day: "2026-06-03",
    start: "13:15",
    end: "13:45",
    title: "Inauguración área comercial / receso café",
    roomId: "cic-general",
    track: "Comercial",
  },
  {
    id: "2026-06-03-curso-pedia",
    day: "2026-06-03",
    start: "15:00",
    end: "17:30",
    title: "Curso trans-congreso: Pediatría",
    roomId: "maito",
    track: "Cursos",
    coordinators: ["Karina Meza Ocaña", "Carolina Rojas Ramírez"],
  },
  {
    id: "2026-06-03-curso-robot",
    day: "2026-06-03",
    start: "15:00",
    end: "17:30",
    title: "Video teatro robótica",
    roomId: "caletas",
    track: "Cursos",
    coordinators: ["Alejandro Sierra Torres"],
  },
  {
    id: "2026-06-03-curso-nlp",
    day: "2026-06-03",
    start: "15:00",
    end: "17:30",
    title: "NLP / URS flexible",
    roomId: "quimixto",
    track: "Cursos",
    coordinators: ["Edgar Beltrán Suárez"],
  },
  {
    id: "2026-06-03-curso-nefrectomia",
    day: "2026-06-03",
    start: "15:00",
    end: "17:30",
    title: "Nefrectomía parcial",
    roomId: "majahuitas",
    track: "Cursos",
    coordinators: ["Gonzalo Vitagliano"],
    speakers: ["Gonzalo Vitagliano"],
  },
  {
    id: "2026-06-03-inauguracion",
    day: "2026-06-03",
    start: "19:00",
    end: "23:00",
    title: "Ceremonia de inauguración y cóctel",
    roomId: "cic-general",
    track: "Social",
  },

  // Jueves 4
  {
    id: "2026-06-04-registro",
    day: "2026-06-04",
    start: "07:00",
    end: "16:00",
    title: "Registro",
    roomId: "cic-general",
    track: "Logística",
  },
  {
    id: "2026-06-04-tena",
    day: "2026-06-04",
    start: "07:30",
    end: "08:30",
    title: "Desayuno con el experto TENA — continencia",
    roomId: "majahuitas",
    track: "Desayuno",
    sponsor: "TENA",
    speakers: ["Daniel Camaou", "Melissa Nieto"],
  },
  {
    id: "2026-06-04-asac",
    day: "2026-06-04",
    start: "07:30",
    end: "08:30",
    title: "Desayuno IPI ASAC — inmunidad uroepitelio",
    roomId: "maito",
    track: "Desayuno",
    sponsor: "ASAC México",
    speakers: ["Hegel T. Santamaría", "Antonio Esqueda Mendoza"],
  },
  {
    id: "2026-06-04-boston",
    day: "2026-06-04",
    start: "09:00",
    end: "10:00",
    title: "Taller Boston Scientific — terapia de vapor en HBP",
    roomId: "quimixto",
    track: "Taller",
    sponsor: "Boston Scientific",
    speakers: ["Carlos Méndez Probst", "Reyes Vallejo"],
    tags: ["hbp", "boston"],
  },
  {
    id: "2026-06-04-hpb",
    day: "2026-06-04",
    start: "08:15",
    end: "10:00",
    title: "HPB / enucleación (HoLEP, Thulio, BipolEP, DISS)",
    roomId: "cic-general",
    track: "HPB",
    speakers: [
      "Sascha Ahyai",
      "Hugo López Ramos",
      "José Ramón Pérez Carral",
      "Thiago Sato",
      "Tim Large",
      "John Denstedt",
    ],
    coordinators: ["Ricardo Leal Marroquín", "Daniel Vázquez Pérez"],
    tags: ["hbp", "laser"],
  },
  {
    id: "2026-06-04-vejiga",
    day: "2026-06-04",
    start: "10:45",
    end: "13:00",
    title: "Cáncer de vejiga (NMIBC, BCG, terapias intravesicales)",
    roomId: "cic-general",
    track: "Oncología",
    speakers: [
      "Joan Palou Redorta",
      "Gustavo Martín Villoldo",
      "Peter Black",
      "Félix Guerrero Ramos",
      "Steven Campbell",
    ],
    tags: ["vejiga", "oncologia"],
  },
  {
    id: "2026-06-04-renal",
    day: "2026-06-04",
    start: "13:30",
    end: "15:00",
    title: "Cáncer renal (enucleación robótica, nefrectomía parcial, metastatectomía)",
    roomId: "cic-general",
    track: "Oncología",
    speakers: [
      "Joan Palou Redorta",
      "Karim Touijer",
      "Steven Campbell",
      "Gonzalo Vitagliano",
    ],
    tags: ["renal", "robotica"],
  },

  // Viernes 5
  {
    id: "2026-06-05-registro",
    day: "2026-06-05",
    start: "08:00",
    end: "16:00",
    title: "Registro",
    roomId: "cic-general",
    track: "Logística",
  },
  {
    id: "2026-06-05-endo",
    day: "2026-06-05",
    start: "08:30",
    end: "10:30",
    title: "Endourología / litiasis (láseres, DISS, FANS)",
    roomId: "cic-general",
    track: "Endourología",
    speakers: [
      "John Denstedt",
      "Guohua Zeng",
      "Tim Large",
      "Hugo López Ramos",
      "Jorge Gutiérrez Aceves",
    ],
    coordinators: ["Edgar Beltrán Suárez"],
    tags: ["endourologia", "litiasis"],
  },
  {
    id: "2026-06-05-prostata",
    day: "2026-06-05",
    start: "11:00",
    end: "13:15",
    title: "Cáncer de próstata (vigilancia, PSMA, neoadyuvancia, linfadenectomía)",
    roomId: "cic-general",
    track: "Oncología",
    speakers: ["Stacy Loeb", "Robert Reiter", "Karim Touijer"],
    tags: ["prostata", "psma"],
  },
  {
    id: "2026-06-05-avanzado",
    day: "2026-06-05",
    start: "13:15",
    end: "14:30",
    title: "Cáncer de próstata avanzado",
    roomId: "cic-general",
    track: "Oncología",
    speakers: ["Rafael Coelho", "Juan Gómez Rivas", "Erick Sierra Díaz"],
    coordinators: ["Itzel Sánchez Ruvalcaba"],
    tags: ["prostata"],
  },
  {
    id: "2026-06-05-silanes",
    day: "2026-06-05",
    start: "14:00",
    end: "14:45",
    title: "Simposio Silanes",
    roomId: "cic-general",
    track: "Simposio",
    speakers: ["Ana Silvia Vidal Brant"],
    sponsor: "Silanes",
  },
  {
    id: "2026-06-05-asamblea",
    day: "2026-06-05",
    start: "13:45",
    end: "15:45",
    title: "Asamblea General",
    roomId: "majahuitas",
    track: "Institucional",
  },
  {
    id: "2026-06-05-cena",
    day: "2026-06-05",
    start: "20:00",
    end: "25:00",
    title: "Cena de clausura",
    roomId: "cic-general",
    track: "Social",
  },

  // Sábado 6
  {
    id: "2026-06-06-funcional",
    day: "2026-06-06",
    start: "08:00",
    end: "10:30",
    title: "Urología funcional / fisiología vesical",
    roomId: "cic-general",
    track: "Funcional",
    speakers: ["Juan Carlos Castaño Botero"],
    tags: ["funcional"],
  },
];

export type SpeakerFicha = {
  name: string;
  role: string;
  focus: string;
  days: string[];
  photo?: string | null;
  affiliation?: string;
};

export const SPEAKER_FICHAS: SpeakerFicha[] = [
  {
    name: "René Sotelo Noguera",
    role: "Ponente internacional",
    focus: "Prostatectomía de rescate; IA en cirugía robótica",
    days: ["2026-06-03"],
    photo: null,
  },
  {
    name: "Joan Palou Redorta",
    role: "Ponente internacional",
    focus: "Carcinoma urotelial; enucleación renal robótica",
    days: ["2026-06-04"],
    photo: "Personas/fotos/web/Joan-Palou-Redorta.png",
  },
  {
    name: "Peter Black",
    role: "Ponente internacional",
    focus: "Cáncer vesical NMIBC / BCG",
    days: ["2026-06-04"],
    photo: null,
  },
  {
    name: "Steven Campbell",
    role: "Ponente internacional",
    focus: "Cáncer renal; evidencia reciente RCC",
    days: ["2026-06-04"],
    photo: null,
  },
  {
    name: "Karim Touijer",
    role: "Ponente internacional",
    focus: "Nefrectomía parcial; linfadenectomía en era PSMA",
    days: ["2026-06-04", "2026-06-05"],
    photo: null,
  },
  {
    name: "John Denstedt",
    role: "Ponente internacional",
    focus: "Endourología; láseres; DISS/FANS",
    days: ["2026-06-04", "2026-06-05"],
    photo: null,
  },
  {
    name: "Guohua Zeng",
    role: "Ponente internacional",
    focus: "Endourología; debate monitoreo transoperatorio",
    days: ["2026-06-05"],
    photo: null,
  },
  {
    name: "Robert Reiter",
    role: "Ponente internacional",
    focus: "PET-PSMA; neoadyuvancia; prostatectomía guiada por imagen",
    days: ["2026-06-05"],
    photo: null,
  },
  {
    name: "Stacy Loeb",
    role: "Ponente internacional",
    focus: "Tamizaje y vigilancia activa en cáncer de próstata",
    days: ["2026-06-05"],
    photo: "Personas/fotos/web/Stacy-Loeb.jpg",
  },
  {
    name: "Juan Gómez Rivas",
    role: "Ponente EAU",
    focus: "Cáncer de próstata; EAU",
    days: ["2026-06-03", "2026-06-05"],
    photo: null,
  },
  {
    name: "Tiago Rosito",
    role: "Ponente",
    focus: "Uropediatría; tips vaginoplastia",
    days: ["2026-06-03"],
    photo: null,
  },
  {
    name: "Alysa Yee",
    role: "Ponente",
    focus: "Medicina sexual femenina; deseo sexual hipoactivo",
    days: ["2026-06-03"],
    photo: null,
  },
  {
    name: "Andrés Hernández Porras",
    role: "Presidente CMUN",
    focus: "Mesa Directiva 2025–2027",
    days: ["2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"],
    photo: "Personas/fotos/Andres-Hernandez-Porras.jpg",
  },
];

function roomById(id: RoomId): Room {
  return ROOMS.find((r) => r.id === id) || ROOMS[4];
}

function parseLocal(day: string, hm: string): Date {
  // Treat as Mexico City wall clock via fixed offset -06:00 (no DST in MX since 2022)
  const [h, m] = hm.split(":").map(Number);
  const endH = h >= 24 ? h - 24 : h;
  const dayOffset = h >= 24 ? 1 : 0;
  const d = new Date(`${day}T00:00:00-06:00`);
  d.setTime(d.getTime() + dayOffset * 86400000 + endH * 3600000 + m * 60000);
  return d;
}

export function resolveNow(overrideIso?: string | null): {
  now: Date;
  source: "override" | "demo" | "live";
  isoLocal: string;
} {
  if (overrideIso) {
    const now = new Date(overrideIso);
    return { now, source: "override", isoLocal: overrideIso };
  }
  const live = new Date();
  const start = new Date(`${CONGRESS.startDate}T00:00:00-06:00`);
  const end = new Date(`${CONGRESS.endDate}T23:59:59-06:00`);
  if (live >= start && live <= end) {
    return {
      now: live,
      source: "live",
      isoLocal: live.toISOString(),
    };
  }
  const now = new Date(`${CONGRESS.demoNow}-06:00`);
  return { now, source: "demo", isoLocal: CONGRESS.demoNow };
}

export type AgendaSnapshot = {
  nowIso: string;
  source: "override" | "demo" | "live";
  congress: typeof CONGRESS;
  current: Array<ProgramSession & { room: Room }>;
  next: Array<ProgramSession & { room: Room; startsInMin: number }>;
  daySessions: Array<ProgramSession & { room: Room }>;
};

export function getAgendaAt(overrideIso?: string | null): AgendaSnapshot {
  const { now, source, isoLocal } = resolveNow(overrideIso);
  const day = now
    .toLocaleDateString("en-CA", { timeZone: CONGRESS.timezone })
    .slice(0, 10);

  const enriched = SESSIONS.map((s) => ({
    ...s,
    room: roomById(s.roomId),
    startAt: parseLocal(s.day, s.start),
    endAt: parseLocal(s.day, s.end),
  }));

  const current = enriched
    .filter((s) => now >= s.startAt && now < s.endAt)
    .map(({ startAt: _a, endAt: _b, ...rest }) => rest);

  const next = enriched
    .filter((s) => s.startAt > now)
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
    .slice(0, 6)
    .map(({ startAt, endAt: _b, ...rest }) => ({
      ...rest,
      startsInMin: Math.round((startAt.getTime() - now.getTime()) / 60000),
    }));

  const daySessions = enriched
    .filter((s) => s.day === day)
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
    .map(({ startAt: _a, endAt: _b, ...rest }) => rest);

  return {
    nowIso: isoLocal,
    source,
    congress: CONGRESS,
    current,
    next,
    daySessions,
  };
}

export function findSessions(query: string): Array<ProgramSession & { room: Room }> {
  const q = query.toLowerCase();
  return SESSIONS.filter((s) => {
    const hay = [
      s.title,
      s.track,
      s.sponsor,
      ...(s.speakers || []),
      ...(s.coordinators || []),
      ...(s.tags || []),
      roomById(s.roomId).name,
      roomById(s.roomId).shortName,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(q) || q.split(/\s+/).every((w) => w.length < 3 || hay.includes(w));
  }).map((s) => ({ ...s, room: roomById(s.roomId) }));
}

export function findRoom(query: string): Room | null {
  const q = query.toLowerCase();
  return (
    ROOMS.find(
      (r) =>
        r.id === q ||
        r.shortName.toLowerCase() === q ||
        r.name.toLowerCase().includes(q) ||
        q.includes(r.shortName.toLowerCase())
    ) || null
  );
}

export function findSponsors(query?: string): Sponsor[] {
  if (!query) return SPONSORS;
  const q = query.toLowerCase();
  return SPONSORS.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.tier.includes(q) ||
      (s.activities || []).some((a) => a.toLowerCase().includes(q)) ||
      (s.notes || "").toLowerCase().includes(q)
  );
}

export function programIndexMarkdown(): string {
  return [
    "## Índice estructurado del programa (JSON interno)",
    `Congreso: ${CONGRESS.name} · ${CONGRESS.startDate} → ${CONGRESS.endDate}`,
    `Sede: ${CONGRESS.venue}`,
    `Sesiones indexadas: ${SESSIONS.length} · Salones: ${ROOMS.length} · Patrocinadores: ${SPONSORS.length}`,
    "Usa este índice (no inventes horarios). Si falta un minuto exacto, di que es bloque aproximado del programa oficial.",
  ].join("\n");
}

export function agendaToMarkdown(a: AgendaSnapshot): string {
  const fmt = (s: ProgramSession & { room: Room }) =>
    `| ${s.start}–${s.end} | ${s.title} | ${s.room.shortName} | ${(s.speakers || []).slice(0, 2).join(", ") || "—"} | ${s.sponsor || "—"} |`;

  const parts = [
    "## Agenda en vivo (programa estructurado)",
    `Ahora: \`${a.nowIso}\` (fuente: **${a.source}**${a.source === "demo" ? " — fuera de fechas reales del congreso; reloj demo jueves 4" : ""})`,
    programIndexMarkdown(),
  ];

  if (a.current.length) {
    parts.push(
      "### En curso ahora\n| Horario | Sesión | Salón | Ponentes | Patrocinio |\n|---|---|---|---|---|\n" +
        a.current.map(fmt).join("\n")
    );
  } else {
    parts.push("### En curso ahora\nNinguna sesión indexada en este minuto.");
  }

  if (a.next.length) {
    parts.push(
      "### Siguiente\n| En | Horario | Sesión | Salón |\n|---|---|---|---|\n" +
        a.next
          .map(
            (s) =>
              `| ${s.startsInMin} min | ${s.start}–${s.end} | ${s.title} | ${s.room.shortName} |`
          )
          .join("\n")
    );
  }

  if (a.daySessions.length) {
    parts.push(
      "### Programa del día (indexado)\n| Horario | Sesión | Salón | Ponentes | Patrocinio |\n|---|---|---|---|---|\n" +
        a.daySessions.map(fmt).join("\n")
    );
  }

  parts.push(
    "### Salones CIC\n" +
      ROOMS.filter((r) => !["hospital-33", "hosp-nuevo-vallarta", "el-tigre"].includes(r.id))
        .map((r) => `- **${r.shortName}**: ${r.tip}`)
        .join("\n")
  );

  return parts.join("\n\n");
}

export function detectProgramIntent(prompt: string): {
  agenda: boolean;
  rooms: boolean;
  sponsors: boolean;
  speakers: boolean;
  search?: string;
} {
  const q = prompt.toLowerCase();
  return {
    agenda:
      /qu[eé] (hay|est[aá]|sigue|pasa)|ahora|siguiente|en \d+ ?min|agenda|programa (de )?hoy|mi[eé]rcoles|jueves|viernes|martes|s[aá]bado|horario/.test(
        q
      ),
    rooms:
      /sal[oó]n|maito|quimixto|caletas|majahuitas|d[oó]nde (es|queda|se imparte)|ubicaci[oó]n del sal[oó]n/.test(
        q
      ),
    sponsors:
      /patrocin|sponsor|astellas|boston scientific|liomont|senosiain|silanes|tena|asac|oro|plata|bronce/.test(
        q
      ),
    speakers:
      /ponente|ficha|curriculum|cv|biograf|qui[eé]n (es|habla|imparte)|faculty|palou|sotelo|denstedt|reiter|loeb|touijer|zeng|g[oó]mez rivas/.test(
        q
      ),
    search: prompt.trim().slice(0, 120),
  };
}
