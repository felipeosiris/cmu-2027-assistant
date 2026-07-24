/** Base del API (vacío = same-origin). En Firebase Hosting apunta al backend. */
export const API_BASE = String(import.meta.env.VITE_API_BASE || "").replace(
  /\/$/,
  ""
);

export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return API_BASE ? `${API_BASE}${p}` : p;
}

/** True cuando no hay backend alcanzable (solo UI estática). */
export const IS_STATIC =
  typeof window !== "undefined" &&
  !API_BASE &&
  /(\.web\.app|\.firebaseapp\.com)$/i.test(window.location.hostname);
