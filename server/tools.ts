/** Live tools: Open-Meteo + Google Places (FanPass key). */

export const CIC_PV = {
  name: "Centro Internacional de Convenciones de Puerto Vallarta",
  lat: 20.6534,
  lon: -105.2253,
  city: "Puerto Vallarta, Jalisco",
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
    "Ropa cómoda de primavera; lleva una capa ligera por el aire acondicionado del CIC.";
  if (feels >= 32 || c.temperature_2m >= 30) {
    clothingTip =
      "Hace calor: ropa ligera, hidratación y evita saco grueso fuera del salón (el CIC suele estar fresco por AC).";
  } else if (feels <= 22) {
    clothingTip =
      "Sensación fresca: lleva una chaqueta ligera; dentro del CIC el AC puede bajar más la temperatura.";
  }
  if (c.precipitation > 0 || [51, 61, 63, 65, 80, 95].includes(c.weather_code)) {
    clothingTip += " Hay lluvia o riesgo: lleva paraguas entre el hotel y el CIC.";
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

export type PlaceResult = {
  name: string;
  rating?: number;
  userRatings?: number;
  vicinity?: string;
  openNow?: boolean;
  types?: string[];
};

export async function fetchNearbyRestaurants(
  lat = CIC_PV.lat,
  lon = CIC_PV.lon,
  radiusMeters = 1200
): Promise<PlaceResult[]> {
  const url = new URL(
    "https://maps.googleapis.com/maps/api/place/nearbysearch/json"
  );
  url.searchParams.set("location", `${lat},${lon}`);
  url.searchParams.set("radius", String(radiusMeters));
  url.searchParams.set("type", "restaurant");
  url.searchParams.set("language", "es");
  url.searchParams.set("key", PLACES_KEY);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Places HTTP ${res.status}`);
  const data = (await res.json()) as {
    status: string;
    results?: Array<{
      name: string;
      rating?: number;
      user_ratings_total?: number;
      vicinity?: string;
      opening_hours?: { open_now?: boolean };
      types?: string[];
    }>;
    error_message?: string;
  };
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(data.error_message || `Places status ${data.status}`);
  }
  return (data.results || [])
    .slice(0, 8)
    .map((r) => ({
      name: r.name,
      rating: r.rating,
      userRatings: r.user_ratings_total,
      vicinity: r.vicinity,
      openNow: r.opening_hours?.open_now,
      types: r.types?.slice(0, 4),
    }));
}

function wantsWeather(q: string) {
  return /clima|temperatura|calor|fr[ií]o|lluvia|ropa|paraguas|vestir|sensaci[oó]n/i.test(
    q
  );
}

function wantsFood(q: string) {
  return /restaurante|comer|comida|cenar|almorzar|desayun|caf[eé]|bar|donde comer|gastronom/i.test(
    q
  );
}

/** Prefetch live context for the agent when the user question needs it (or always light weather). */
export async function buildLiveContext(prompt: string): Promise<string> {
  const parts: string[] = [];
  const needFood = wantsFood(prompt);
  const needWeather = wantsWeather(prompt) || needFood || true; // always inject weather for proactivity

  try {
    if (needWeather) {
      const w = await fetchWeather();
      parts.push(
        `## Clima en vivo (Open-Meteo) cerca del CIC PV\n\`\`\`json\n${JSON.stringify(w, null, 2)}\n\`\`\``
      );
    }
  } catch (e) {
    parts.push(
      `## Clima\nNo disponible ahora: ${e instanceof Error ? e.message : e}`
    );
  }

  try {
    if (needFood || /ponencia|sesi[oó]n|hueco|receso|break/i.test(prompt)) {
      const places = await fetchNearbyRestaurants();
      parts.push(
        `## Restaurantes cercanos al CIC (Google Places / FanPass)\n\`\`\`json\n${JSON.stringify(places, null, 2)}\n\`\`\``
      );
    }
  } catch (e) {
    parts.push(
      `## Restaurantes\nNo disponible ahora: ${e instanceof Error ? e.message : e}`
    );
  }

  return parts.join("\n\n");
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
