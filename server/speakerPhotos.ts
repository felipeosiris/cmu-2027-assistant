/**
 * Resolución proactiva de fotos de ponentes.
 * Solo acepta coincidencias de alta confianza (≥0.9).
 * Fuentes: bóveda, seeds oficiales, og:image de perfiles, Wikipedia/Wikidata, Google CSE (opcional).
 */

import fs from "node:fs";
import path from "node:path";

const UA = "CMU-2027-Assistant/1.0 (educational; congress assistant)";

export type PhotoHit = {
  name: string;
  photoUrl: string;
  localPath?: string;
  source: "vault" | "seed" | "profile" | "wikipedia" | "wikidata" | "google";
  confidence: number;
  sourceTitle?: string;
  sourcePageUrl?: string;
  reason: string;
};

type Seed = {
  local?: string;
  imageUrl?: string;
  profileUrl?: string;
  credit: string;
};

/** Seeds verificados (páginas oficiales / prensa institucional). */
const PHOTO_SEEDS: Record<string, Seed> = {
  "Joan Palou Redorta": {
    local: "Personas/fotos/web/Joan-Palou-Redorta.png",
    imageUrl:
      "https://fundaciopuigvert.org/wp-content/uploads/2026/03/Joan-Palou-Redorta.png",
    profileUrl:
      "https://fundaciopuigvert.org/en/professionals/joan-palou-redorta/",
    credit: "Fundació Puigvert (perfil oficial)",
  },
  "Stacy Loeb": {
    local: "Personas/fotos/web/Stacy-Loeb.jpg",
    imageUrl:
      "https://mediasvc.eurekalert.org/Api/v1/Multimedia/fee3885c-33ae-4c1c-a1e2-1e76122ac2ae/Rendition/low-res/Content/Public",
    profileUrl: "https://stacyloeb.com/about-dr-loeb/",
    credit: "NYU Langone / EurekAlert",
  },
  "René Sotelo Noguera": {
    profileUrl: "https://doctorsotelo.com/",
    credit: "Perfil doctorsotelo.com",
  },
  "John Denstedt": {
    profileUrl: "https://www.schulich.uwo.ca/urology/people/faculty/Denstedt,%20John.html",
    credit: "Western University faculty page",
  },
};

const MEDICAL_HINT =
  /urolog|surgeon|médic|medic|oncol|professor|profesor|doctor|hospital|clinic|universidad|university|facultad|androlog|endourol|researcher|investigador/i;

function slugify(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(
      (t) =>
        t.length > 2 &&
        !["dr", "dra", "the", "van", "del", "de", "la", "md"].includes(t)
    );
}

function titleMatchesName(title: string, name: string): boolean {
  const tt = nameTokens(title);
  const nn = nameTokens(name);
  if (nn.length < 2) return false;
  const hit = nn.filter((t) => tt.some((x) => x.includes(t) || t.includes(x)));
  return hit.length >= Math.min(nn.length, 2) && hit.length / nn.length >= 0.7;
}

function findSeed(name: string): Seed | null {
  if (PHOTO_SEEDS[name]) return PHOTO_SEEDS[name];
  const key = Object.keys(PHOTO_SEEDS).find((k) => titleMatchesName(k, name));
  return key ? PHOTO_SEEDS[key] : null;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function fetchOgImage(profileUrl: string): Promise<string | null> {
  try {
    const res = await fetch(profileUrl, {
      headers: { "User-Agent": UA, Accept: "text/html" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m =
      html.match(
        /property=["']og:image["'][^>]*content=["']([^"']+)["']/i
      ) ||
      html.match(
        /content=["']([^"']+)["'][^>]*property=["']og:image["']/i
      );
    const url = m?.[1];
    if (!url) return null;
    // skip logos
    if (/logo|sprite|brand|favicon|imago|ilus/i.test(url)) return null;
    return url;
  } catch {
    return null;
  }
}

async function downloadToVault(
  vaultRoot: string,
  name: string,
  photoUrl: string
): Promise<{ localRel: string } | null> {
  const dir = path.join(vaultRoot, "Personas", "fotos", "web");
  fs.mkdirSync(dir, { recursive: true });
  const ext = /\.png(\?|$)/i.test(photoUrl)
    ? ".png"
    : /\.webp(\?|$)/i.test(photoUrl)
      ? ".webp"
      : ".jpg";
  const abs = path.join(dir, `${slugify(name)}${ext}`);
  const localRel = `Personas/fotos/web/${slugify(name)}${ext}`;

  if (fs.existsSync(abs) && fs.statSync(abs).size > 1000) {
    return { localRel };
  }

  const res = await fetch(photoUrl, {
    headers: { "User-Agent": UA, Accept: "image/*" },
  });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 800) return null;
  fs.writeFileSync(abs, buf);
  return { localRel };
}

async function tryGoogleCse(name: string): Promise<PhotoHit | null> {
  const key =
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_CSE_API_KEY ||
    process.env.GOOGLE_PLACES_API_KEY;
  const cx = process.env.GOOGLE_CSE_ID;
  if (!key || !cx) return null;

  const q = `"${name}" (urologist OR urología OR urology OR urólogo)`;
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", key);
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", q);
  url.searchParams.set("searchType", "image");
  url.searchParams.set("num", "5");
  url.searchParams.set("safe", "active");

  try {
    const data = await getJson<{
      items?: Array<{
        link?: string;
        title?: string;
        image?: { contextLink?: string };
        displayLink?: string;
      }>;
    }>(url.toString());
    for (const item of data.items || []) {
      const blob = `${item.title || ""} ${item.displayLink || ""} ${item.image?.contextLink || ""}`;
      if (!titleMatchesName(blob, name)) continue;
      if (!MEDICAL_HINT.test(blob) && !/urolog|puigvert|nyu|usc|western|edu/i.test(blob))
        continue;
      if (!item.link) continue;
      return {
        name,
        photoUrl: item.link,
        source: "google",
        confidence: 0.92,
        sourceTitle: item.title,
        sourcePageUrl: item.image?.contextLink,
        reason: `Google CSE: título/contexto coincide con ${name} + urología`,
      };
    }
  } catch (e) {
    console.warn("[photo/google]", e);
  }
  return null;
}

async function tryWikipedia(name: string): Promise<PhotoHit | null> {
  for (const lang of ["en", "es"] as const) {
    const searchUrl = new URL(`https://${lang}.wikipedia.org/w/api.php`);
    searchUrl.searchParams.set("action", "opensearch");
    searchUrl.searchParams.set("search", `${name} urology`);
    searchUrl.searchParams.set("limit", "5");
    searchUrl.searchParams.set("format", "json");
    let titles: string[] = [];
    try {
      const data = await getJson<[string, string[]]>(searchUrl.toString());
      titles = data[1] || [];
    } catch {
      continue;
    }
    for (const title of titles) {
      if (!titleMatchesName(title, name)) continue;
      try {
        const sumRes = await fetch(
          `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
          { headers: { Accept: "application/json", "User-Agent": UA } }
        );
        if (!sumRes.ok) continue;
        const sum = (await sumRes.json()) as {
          title: string;
          description?: string;
          extract?: string;
          thumbnail?: { source: string };
          content_urls?: { desktop?: { page?: string } };
        };
        if (!sum.thumbnail?.source) continue;
        const blob = `${sum.title} ${sum.description || ""} ${sum.extract || ""}`;
        if (!MEDICAL_HINT.test(blob)) continue;
        return {
          name,
          photoUrl: sum.thumbnail.source,
          source: "wikipedia",
          confidence: 0.95,
          sourceTitle: sum.title,
          sourcePageUrl: sum.content_urls?.desktop?.page,
          reason: `Wikipedia (${lang}): nombre + contexto médico`,
        };
      } catch {
        continue;
      }
    }
  }
  return null;
}

/** Resuelve foto solo si confianza ≥ 0.9. */
export async function resolveSpeakerPhoto(
  name: string,
  vaultRoot: string,
  existingPhoto?: string | null
): Promise<PhotoHit | null> {
  if (existingPhoto) {
    const abs = path.resolve(vaultRoot, existingPhoto);
    if (fs.existsSync(abs)) {
      return {
        name,
        photoUrl: `/api/vault/${existingPhoto}`,
        localPath: existingPhoto,
        source: "vault",
        confidence: 1,
        reason: "Foto en bóveda",
      };
    }
  }

  // Cache web por slug
  const webDir = path.join(vaultRoot, "Personas", "fotos", "web");
  if (fs.existsSync(webDir)) {
    const slug = slugify(name).toLowerCase();
    for (const f of fs.readdirSync(webDir)) {
      if (f.toLowerCase().startsWith(slug) || slugify(f).toLowerCase().includes(slug)) {
        const rel = `Personas/fotos/web/${f}`;
        return {
          name,
          photoUrl: `/api/vault/${rel}`,
          localPath: rel,
          source: "vault",
          confidence: 0.98,
          reason: "Cache local web (alta confianza previa)",
        };
      }
    }
  }

  const seed = findSeed(name);
  if (seed?.local) {
    const abs = path.resolve(vaultRoot, seed.local);
    if (fs.existsSync(abs)) {
      return {
        name,
        photoUrl: `/api/vault/${seed.local}`,
        localPath: seed.local,
        source: "seed",
        confidence: 1,
        reason: seed.credit,
        sourcePageUrl: seed.profileUrl,
      };
    }
  }
  if (seed?.imageUrl) {
    try {
      const saved = await downloadToVault(vaultRoot, name, seed.imageUrl);
      if (saved) {
        return {
          name,
          photoUrl: `/api/vault/${saved.localRel}`,
          localPath: saved.localRel,
          source: "seed",
          confidence: 1,
          reason: seed.credit,
          sourcePageUrl: seed.profileUrl,
        };
      }
    } catch (e) {
      console.warn("[photo/seed]", e);
    }
  }
  if (seed?.profileUrl) {
    const og = await fetchOgImage(seed.profileUrl);
    if (og) {
      try {
        const saved = await downloadToVault(vaultRoot, name, og);
        if (saved) {
          return {
            name,
            photoUrl: `/api/vault/${saved.localRel}`,
            localPath: saved.localRel,
            source: "profile",
            confidence: 0.94,
            reason: `og:image de perfil oficial (${seed.credit})`,
            sourcePageUrl: seed.profileUrl,
          };
        }
      } catch {
        /* continue */
      }
    }
  }

  let hit =
    (await tryGoogleCse(name).catch(() => null)) ||
    (await tryWikipedia(name).catch(() => null));

  if (!hit || hit.confidence < 0.9) return null;

  try {
    const saved = await downloadToVault(vaultRoot, name, hit.photoUrl);
    if (saved) {
      hit.localPath = saved.localRel;
      hit.photoUrl = `/api/vault/${saved.localRel}`;
    }
  } catch (e) {
    console.warn("[photo/download]", e);
  }
  return hit;
}

export async function enrichSpeakersWithPhotos<
  T extends { name: string; photo?: string | null },
>(speakers: T[], vaultRoot: string): Promise<Array<T & { photoHit?: PhotoHit | null }>> {
  const out: Array<T & { photoHit?: PhotoHit | null }> = [];
  for (const s of speakers) {
    try {
      const photoHit = await resolveSpeakerPhoto(s.name, vaultRoot, s.photo);
      out.push({
        ...s,
        photo: photoHit?.localPath || s.photo || null,
        photoHit,
      });
    } catch {
      out.push({ ...s, photoHit: null });
    }
  }
  return out;
}
