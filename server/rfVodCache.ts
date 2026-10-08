import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

/**
 * Caché persistente de mapas de embeds de UnlimPlay en Firestore (richardflix-prod).
 * Credencial: RF_FIREBASE_SA = JSON de la cuenta de servicio en base64.
 */

const COLLECTION = "vodCache";
/** Los links "direct" (vimeos) caducan a las ~12 h. */
export const VOD_CACHE_TTL_MS = 8 * 60 * 60 * 1000;

export type VodCacheDoc = {
  data: Record<string, Record<string, string>> | null;
  updatedAt: number;
};

let db: Firestore | null | undefined;
export let vodCacheInitError: string | null = null;

function getDb(): Firestore | null {
  if (db !== undefined) return db;
  const raw = process.env.RF_FIREBASE_SA?.trim();
  if (!raw) {
    db = null;
    return db;
  }
  try {
    const json = JSON.parse(
      raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8"),
    );
    const app: App =
      getApps().find((a) => a.name === "rf-vod-cache") ??
      initializeApp({ credential: cert(json), projectId: json.project_id }, "rf-vod-cache");
    db = getFirestore(app);
  } catch (e) {
    vodCacheInitError = e instanceof Error ? e.message.slice(0, 120) : "error";
    console.error("[rfVodCache] credencial inválida:", vodCacheInitError);
    db = null;
  }
  return db;
}

export function vodCacheEnabled(): boolean {
  return getDb() !== null;
}

function docId(key: string): string {
  return key.replace(/[/:]/g, "_");
}

export async function vodCacheGet(key: string): Promise<VodCacheDoc | null> {
  const store = getDb();
  if (!store) return null;
  try {
    const snap = await store.collection(COLLECTION).doc(docId(key)).get();
    if (!snap.exists) return null;
    const doc = snap.data() as VodCacheDoc;
    if (!doc?.updatedAt || Date.now() - doc.updatedAt > VOD_CACHE_TTL_MS) return null;
    return doc;
  } catch (e) {
    console.warn("[rfVodCache] get:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Links vimeos: s = emisión (epoch s), e = vigencia en s. Margen de 1 h. */
function directStillValid(url: string): boolean {
  try {
    const q = new URL(url).searchParams;
    const s = Number(q.get("s"));
    const e = Number(q.get("e"));
    if (!s || !e) return false;
    return (s + e) * 1000 - Date.now() > 60 * 60 * 1000;
  } catch {
    return false;
  }
}

export async function vodCacheSet(
  key: string,
  data: VodCacheDoc["data"],
): Promise<void> {
  const store = getDb();
  if (!store) return;
  try {
    const ref = store.collection(COLLECTION).doc(docId(key));
    if (data && !data.latino?.direct) {
      const prev = (await ref.get()).data() as VodCacheDoc | undefined;
      const prevDirect = prev?.data?.latino?.direct;
      if (prevDirect && directStillValid(prevDirect)) {
        data = { ...data, latino: { direct: prevDirect, ...(data.latino ?? {}) } };
      }
    }
    await ref.set({ data, updatedAt: Date.now() } satisfies VodCacheDoc);
  } catch (e) {
    console.warn("[rfVodCache] set:", e instanceof Error ? e.message : e);
  }
}

/** Series que se mantienen completas en caché (colección vodPinned, id = tmdbId). */
export async function vodPinnedSeries(): Promise<number[]> {
  const store = getDb();
  if (!store) return [];
  try {
    const snap = await store.collection("vodPinned").get();
    return snap.docs.map((d) => Number(d.id)).filter((n) => Number.isFinite(n) && n > 0);
  } catch (e) {
    console.warn("[rfVodCache] pinned:", e instanceof Error ? e.message : e);
    return [];
  }
}

/** updatedAt de varias llaves en una sola lectura por lote. */
export async function vodCacheAges(keys: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const store = getDb();
  if (!store || !keys.length) return out;
  const col = store.collection(COLLECTION);
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100);
    const snaps = await store.getAll(...chunk.map((k) => col.doc(docId(k))));
    snaps.forEach((s, idx) => {
      if (s.exists) out.set(chunk[idx]!, (s.data() as VodCacheDoc).updatedAt ?? 0);
    });
  }
  return out;
}
