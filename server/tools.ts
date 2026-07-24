/** Live tools: Open-Meteo + Google Places (FanPass) + mapas + APIs médicas + programa. */

import {
  buildMedicalContext,
  medicalBundleToMarkdown,
} from "./medical.js";
import {
  CONGRESS,
  ROOMS,
  SPEAKER_FICHAS,
  SPONSORS,
  SESSIONS,
  agendaToMarkdown,
  detectProgramIntent,
  findRoom,
  findSessions,
  findSponsors,
  getAgendaAt,
  programIndexMarkdown,
} from "./program.js";
import { enrichSpeakersWithPhotos } from "./speakerPhotos.js";

export const CIC_PV = {
  name: "Centro Internacional de Convenciones de Puerto Vallarta",
  shortName: "CIC Puerto Vallarta",
  lat: 20.6534,
  lon: -105.2253,
  city: "Puerto Vallarta, Jalisco",
  address: "Puerto Vallarta, Jalisco, México",
} as const;

const PLACES_KEY =
  process.env.GOOGLE_PLACES_API_KEY ||
  "AIzaSyDcjBH-d5PcKPAAzt683TFT6h30t6YwVNY";

const WMO: Record<number, string> = {
  0: "Despejado",
  1: "Mayormente despejado",
  2: "Parcialmente nublado",
  3: "Nublado",
  45: "Niebla",
  48: "Niebla con escarcha",
  51: "Llovizna ligera",
  61: "Lluvia ligera",
  63: "Lluvia moderada",
  65: "Lluvia intensa",
  80: "Chubascos",
  95: "Tormenta",
};

export type WeatherSnapshot = {
  location: string;
  time: string;
  temperatureC: number;
  feelsLikeC: number;
  humidityPct: number;
  precipitationMm: number;
  windKmh: number;
  condition: string;
  clothingTip: string;
};

export type PlaceResult = {
  name: string;
  rating?: number;
  userRatings?: number;
  vicinity?: string;
  openNow?: boolean;
  types?: string[];
  lat: number;
  lon: number;
  placeId?: string;
  category: string;
  mapEmbedUrl: string;
  googleMapsUrl: string;
  directionsFromCicUrl: string;
};

export type LiveBundle = {
  markdown: string;
  places: PlaceResult[];
  venue?: PlaceResult;
};

function mapEmbedUrl(lat: number, lon: number, delta = 0.006): string {
  const bbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(
    bbox
  )}&layer=mapnik&marker=${lat}%2C${lon}`;
}

function googleMapsUrl(lat: number, lon: number, name?: string): string {
  const q = name
    ? encodeURIComponent(`${name} @${lat},${lon}`)
    : `${lat},${lon}`;
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

function directionsFromCic(lat: number, lon: number): string {
  return `https://www.google.com/maps/dir/?api=1&origin=${CIC_PV.lat}%2C${CIC_PV.lon}&destination=${lat}%2C${lon}&travelmode=walking`;
}

export function cicVenuePlace(): PlaceResult {
  return {
    name: CIC_PV.name,
    lat: CIC_PV.lat,
    lon: CIC_PV.lon,
    vicinity: CIC_PV.address,
    category: "sede",
    openNow: true,
    mapEmbedUrl: mapEmbedUrl(CIC_PV.lat, CIC_PV.lon, 0.01),
    googleMapsUrl: googleMapsUrl(CIC_PV.lat, CIC_PV.lon, CIC_PV.name),
    directionsFromCicUrl: googleMapsUrl(CIC_PV.lat, CIC_PV.lon, CIC_PV.name),
  };
}

export async function fetchWeather(
  lat = CIC_PV.lat,
  lon = CIC_PV.lon
): Promise<WeatherSnapshot> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set(
    "current",
    "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m"
  );
  url.searchParams.set("timezone", "America/Mexico_City");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const data = (await res.json()) as {
    current: {
      time: string;
      temperature_2m: number;
      apparent_temperature: number;
      relative_humidity_2m: number;
      precipitation: number;
      weather_code: number;
      wind_speed_10m: number;
    };
  };
  const c = data.current;
  const feels = c.apparent_temperature;
  let clothingTip =
    "Ropa cómoda; lleva una capa ligera por el aire acondicionado del CIC.";
  if (feels >= 32 || c.temperature_2m >= 30) {
    clothingTip =
      "Hace calor: ropa ligera, hidratación; el CIC suele estar fresco por AC.";
  } else if (feels <= 22) {
    clothingTip =
      "Sensación fresca: chaqueta ligera; el AC del CIC puede bajar más la temperatura.";
  }
  if (c.precipitation > 0 || [51, 61, 63, 65, 80, 95].includes(c.weather_code)) {
    clothingTip += " Lluvia o riesgo: paraguas entre hotel y CIC.";
  }

  return {
    location: CIC_PV.name,
    time: c.time,
    temperatureC: c.temperature_2m,
    feelsLikeC: feels,
    humidityPct: c.relative_humidity_2m,
    precipitationMm: c.precipitation,
    windKmh: c.wind_speed_10m,
    condition: WMO[c.weather_code] || `Código ${c.weather_code}`,
    clothingTip,
  };
}

type PlaceType =
  | "restaurant"
  | "cafe"
  | "lodging"
  | "parking"
  | "pharmacy"
  | "hospital"
  | "atm"
  | "bar";

export async function fetchNearbyPlaces(
  type: PlaceType,
  categoryLabel: string,
  lat = CIC_PV.lat,
  lon = CIC_PV.lon,
  radiusMeters = 1400,
  limit = 6
): Promise<PlaceResult[]> {
  const url = new URL(
    "https://maps.googleapis.com/maps/api/place/nearbysearch/json"
  );
  url.searchParams.set("location", `${lat},${lon}`);
  url.searchParams.set("radius", String(radiusMeters));
  url.searchParams.set("type", type);
  url.searchParams.set("language", "es");
  url.searchParams.set("key", PLACES_KEY);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Places HTTP ${res.status}`);
  const data = (await res.json()) as {
    status: string;
    results?: Array<{
      name: string;
      place_id?: string;
      rating?: number;
      user_ratings_total?: number;
      vicinity?: string;
      geometry?: { location?: { lat: number; lng: number } };
      opening_hours?: { open_now?: boolean };
      types?: string[];
    }>;
    error_message?: string;
  };
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(data.error_message || `Places status ${data.status}`);
  }
  return (data.results || [])
    .filter((r) => r.geometry?.location?.lat != null)
    .slice(0, limit)
    .map((r) => {
      const plat = r.geometry!.location!.lat;
      const plon = r.geometry!.location!.lng;
      return {
        name: r.name,
        placeId: r.place_id,
        rating: r.rating,
        userRatings: r.user_ratings_total,
        vicinity: r.vicinity,
        openNow: r.opening_hours?.open_now,
        types: r.types?.slice(0, 4),
        lat: plat,
        lon: plon,
        category: categoryLabel,
        mapEmbedUrl: mapEmbedUrl(plat, plon),
        googleMapsUrl: googleMapsUrl(plat, plon, r.name),
        directionsFromCicUrl: directionsFromCic(plat, plon),
      };
    });
}

export async function fetchNearbyRestaurants(
  lat = CIC_PV.lat,
  lon = CIC_PV.lon,
  radiusMeters = 1200
): Promise<PlaceResult[]> {
  return fetchNearbyPlaces("restaurant", "restaurante", lat, lon, radiusMeters);
}

type Intent = {
  weather: boolean;
  venue: boolean;
  food: boolean;
  cafe: boolean;
  hotel: boolean;
  parking: boolean;
  pharmacy: boolean;
  hospital: boolean;
  atm: boolean;
};

export function detectIntent(prompt: string): Intent {
  const q = prompt.toLowerCase();
  return {
    weather:
      /clima|temperatura|calor|fr[ií]o|lluvia|ropa|paraguas|vestir|sensaci[oó]n/.test(
        q
      ),
    venue:
      /\b(c[ií]c|sede|convenciones)\b|c[oó]mo llegar|ubicaci[oó]n|mapa del? (congreso|cic)|d[oó]nde queda (el )?(c[ií]c|sede)/.test(
        q
      ),
    food: /restaurante|comer|comida|cenar|almorzar|desayun|gastronom|carne|mariscos|tacos/.test(
      q
    ),
    cafe: /caf[eé]|coffee|espresso/.test(q),
    hotel: /hotel|hospedaje|lodging|dónde dormir|hospeda/.test(q),
    parking: /estacionamiento|parking|aparcar|d[oó]nde dejo (el )?(coche|auto)|estacionar/.test(
      q
    ),
    pharmacy: /farmacia|pharmacy|botica|d[oó]nde (compro|encuentro) (medicamento|medicina)/.test(
      q
    ),
    hospital: /hospital|urgencia|emergencia|cruz roja/.test(q),
    atm: /cajero|atm|efectivo|banco/.test(q),
  };
}

/** Prefetch live context + places con coordenadas/mapas para la UI. */
export async function buildLiveContext(
  prompt: string,
  vaultRoot?: string
): Promise<LiveBundle> {
  const intent = detectIntent(prompt);
  const parts: string[] = [];
  const places: PlaceResult[] = [];
  const venue = cicVenuePlace();

  // Always inject weather (proactive for PV heat)
  try {
    const w = await fetchWeather();
    parts.push(
      `## Clima en vivo (Open-Meteo) cerca del CIC\n\`\`\`json\n${JSON.stringify(w, null, 2)}\n\`\`\``
    );
  } catch (e) {
    parts.push(
      `## Clima\nNo disponible: ${e instanceof Error ? e.message : e}`
    );
  }

  // Sede coords solo si preguntan por ubicación / cómo llegar
  if (intent.venue) {
    places.push(venue);
    parts.push(
      `## Sede CIC\n\`\`\`json\n${JSON.stringify(venue, null, 2)}\n\`\`\``
    );
  }

  const wantsPlaces =
    intent.food ||
    intent.cafe ||
    intent.hotel ||
    intent.parking ||
    intent.pharmacy ||
    intent.hospital ||
    intent.atm ||
    intent.venue ||
    // Solo comida/lugar explícito cerca del CIC — NO "ponencia/sesión" solos
    /(dónde|donde).{0,30}(comer|cenar|almorzar|desayun|caf[eé]|hotel|estacion|farmacia|cajero)|cerca del c[ií]c.{0,40}(comer|comida|restaurante|caf[eé]|hotel)|recomend\w*.{0,40}(restaurante|comida|caf[eé]|hotel|lugar(es)? para comer)|(hueco|receso|break).{0,40}(comer|comida|caf[eé])/.test(
      prompt.toLowerCase()
    );

  const jobs: Array<Promise<void>> = [];

  const add = (type: PlaceType, label: string, when: boolean) => {
    if (!when) return;
    jobs.push(
      (async () => {
        try {
          const found = await fetchNearbyPlaces(type, label);
          places.push(...found);
          parts.push(
            `## Lugares: ${label} (Google Places + coords/mapas)\n\`\`\`json\n${JSON.stringify(found, null, 2)}\n\`\`\``
          );
        } catch (e) {
          parts.push(
            `## Lugares: ${label}\nError: ${e instanceof Error ? e.message : e}`
          );
        }
      })()
    );
  };

  const q = prompt.toLowerCase();
  const otherPlaceIntent =
    intent.cafe ||
    intent.hotel ||
    intent.parking ||
    intent.pharmacy ||
    intent.hospital ||
    intent.atm ||
    intent.venue;
  const genericFood =
    intent.food ||
    (wantsPlaces &&
      !otherPlaceIntent &&
      /comer|comida|restaurante|cenar|almorz|recomend/.test(q));

  add("restaurant", "restaurante", genericFood);
  add("cafe", "café", intent.cafe);
  add("lodging", "hotel", intent.hotel);
  add("parking", "estacionamiento", intent.parking);
  add("pharmacy", "farmacia", intent.pharmacy);
  add("hospital", "hospital", intent.hospital);
  add("atm", "cajero", intent.atm);

  // APIs médicas públicas (educativas)
  jobs.push(
    (async () => {
      try {
        const med = await buildMedicalContext(prompt);
        if (med) parts.push(medicalBundleToMarkdown(med));
      } catch (e) {
        console.warn("[medical]", e);
      }
    })()
  );

  // Programa estructurado: agenda / salones / patrocinadores / ponentes
  const prog = detectProgramIntent(prompt);
  if (prog.agenda || prog.rooms || prog.sponsors || prog.speakers) {
    jobs.push(
      (async () => {
        const chunks: string[] = [programIndexMarkdown()];

        if (prog.agenda) {
          chunks.push(agendaToMarkdown(getAgendaAt()));
        }

        if (prog.rooms) {
          const room =
            findRoom(prompt) ||
            ROOMS.find((r) =>
              prompt.toLowerCase().includes(r.shortName.toLowerCase())
            );
          const hits = findSessions(prompt).slice(0, 8);
          chunks.push(
            `## Salones\n\`\`\`json\n${JSON.stringify(room ? [room] : ROOMS, null, 2)}\n\`\`\``
          );
          if (hits.length) {
            chunks.push(
              `## Sesiones en ese salón / búsqueda\n\`\`\`json\n${JSON.stringify(hits, null, 2)}\n\`\`\``
            );
          }
        }

        if (prog.sponsors) {
          const hits = findSponsors(prompt);
          chunks.push(
            `## Patrocinadores\n\`\`\`json\n${JSON.stringify(hits.length ? hits : SPONSORS, null, 2)}\n\`\`\``
          );
        }

        if (prog.speakers) {
          const q = prompt.toLowerCase();
          const fichas = SPEAKER_FICHAS.filter((f) =>
            q.includes(f.name.split(" ")[0].toLowerCase()) ||
            f.name.toLowerCase().split(" ").some((w) => w.length > 3 && q.includes(w.toLowerCase()))
          );
          const list = fichas.length ? fichas : SPEAKER_FICHAS.slice(0, 8);
          const root =
            vaultRoot ||
            process.env.VAULT_CWD ||
            "";
          let enriched: Array<
            (typeof SPEAKER_FICHAS)[number] & {
              photoHit?: Awaited<
                ReturnType<typeof enrichSpeakersWithPhotos>
              >[number]["photoHit"];
            }
          > = list;
          if (root) {
            try {
              const focus = (fichas.length ? fichas : list).slice(0, 4);
              enriched = await enrichSpeakersWithPhotos(focus, root);
            } catch (e) {
              console.warn("[photos]", e);
            }
          }
          chunks.push(
            `## Fichas de ponentes (con foto si confianza ≥ 0.9)\n\`\`\`json\n${JSON.stringify(enriched, null, 2)}\n\`\`\``
          );
          chunks.push(
            `### Instrucción de fotos
Si un ítem tiene photoHit.photoUrl o photo (path local), muestra la imagen:
\`![Nombre](/api/vault/Personas/fotos/...)\` o la URL de photoHit.photoUrl si empieza con /api/.
Solo usa fotos con confidence ≥ 0.9. Si no hay foto segura, dilo en una frase (sin plantilla [FOTO 3x4]).`
          );
        }

        // Búsqueda general de sesiones si mencionan tema
        if (!prog.agenda && (prog.rooms || prog.speakers || prog.sponsors)) {
          const hits = findSessions(prompt).slice(0, 10);
          if (hits.length) {
            chunks.push(
              `## Sesiones relacionadas\n\`\`\`json\n${JSON.stringify(hits, null, 2)}\n\`\`\``
            );
          }
        }

        parts.push(chunks.join("\n\n"));
      })()
    );
  }

  await Promise.all(jobs);

  if (places.length) {
    parts.push(`## Instrucción de mapas
La UI mostrará mini mapas automáticamente con estos lugares (lat/lon, mapEmbedUrl).
En tu respuesta: tabla breve; no inventes coordenadas.`);
  }

  // Dedupe places by name+lat
  const seen = new Set<string>();
  const unique = places.filter((p) => {
    const k = `${p.name}|${p.lat.toFixed(5)}|${p.lon.toFixed(5)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return {
    markdown: parts.join("\n\n"),
    places: unique,
    venue: unique.length ? venue : undefined,
  };
}

/** Short spoken summary: first prose sentences, no tables/code. */
export function voiceSummaryFromMarkdown(md: string, maxChars = 280): string {
  let t = md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\|[^\n]+\|/g, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[[^\]]+\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const sentences = t.match(/[^.!?]+[.!?]+/g) || [t];
  let out = "";
  for (const s of sentences) {
    const next = (out + " " + s).trim();
    if (next.length > maxChars && out) break;
    out = next;
    if (out.length >= 120) break;
  }
  return (out || t).slice(0, maxChars).trim();
}
