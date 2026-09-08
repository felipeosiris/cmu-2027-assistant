/**
 * RichardFlix Music — proxy YouTube Music InnerTube (mismo patrón que FridaMusic).
 * POST/GET /rf/ytm/youtubei/v1/{search|browse|player|...}
 * GET /rf/ytm/audio?videoId=… — resuelve stream y lo sirve (para descargas offline)
 * GET /rf/ytm/media?url=… — proxy de URL googlevideo
 */
import type { Request, Response, Router } from "express";

const YTM_ORIGIN = "https://music.youtube.com";
const YTI_PLAYER = `${YTM_ORIGIN}/youtubei/v1/player?prettyPrint=false`;

type Json = Record<string, unknown>;

const CLIENTS = [
  {
    clientName: "IOS",
    clientVersion: "21.03.1",
    clientId: "5",
    userAgent:
      "com.google.ios.youtube/21.03.1 (iPhone16,2; U; CPU iOS 18_2 like Mac OS X;)",
  },
  {
    clientName: "ANDROID_MUSIC",
    clientVersion: "7.29.51",
    clientId: "21",
    userAgent:
      "com.google.android.apps.youtube.music/7.29.51 (Linux; U; Android 14) gzip",
  },
  {
    clientName: "WEB_REMIX",
    clientVersion: "1.20260213.01.00",
    clientId: "67",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0",
  },
] as const;

function setYtmCors(res: Response): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Accept, Content-Type, X-Goog-Api-Format-Version, X-YouTube-Client-Name, X-YouTube-Client-Version, User-Agent",
  );
  res.setHeader("Access-Control-Max-Age", "86400");
}

function asRecord(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : null;
}

async function resolveAudioUrl(
  videoId: string,
): Promise<{ url: string; mimeType: string } | { error: string }> {
  let lastError = "Sin URL de audio";

  for (const client of CLIENTS) {
    try {
      const body = {
        context: {
          client: {
            clientName: client.clientName,
            clientVersion: client.clientVersion,
            hl: "es",
            gl: "MX",
          },
        },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      };
      const upstream = await fetch(YTI_PLAYER, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": client.userAgent,
          Origin: YTM_ORIGIN,
          Referer: `${YTM_ORIGIN}/`,
          "X-Goog-Api-Format-Version": "1",
          "X-YouTube-Client-Name": client.clientId,
          "X-YouTube-Client-Version": client.clientVersion,
        },
        body: JSON.stringify(body),
      });
      const data = (await upstream.json()) as Json;
      const status = asRecord(data.playabilityStatus);
      const code = typeof status?.status === "string" ? status.status : "";
      if (code && code !== "OK") {
        lastError =
          typeof status?.reason === "string" ? status.reason : code;
        continue;
      }
      const streaming = asRecord(data.streamingData);
      const formats = [
        ...((streaming?.adaptiveFormats as unknown[]) || []),
        ...((streaming?.formats as unknown[]) || []),
      ];
      const audio = formats
        .map((f) => asRecord(f))
        .filter((f): f is Json => Boolean(f))
        .filter(
          (f) =>
            typeof f.mimeType === "string" &&
            String(f.mimeType).includes("audio") &&
            typeof f.url === "string",
        )
        .sort((a, b) => Number(b.bitrate || 0) - Number(a.bitrate || 0));
      const best = audio[0];
      if (best && typeof best.url === "string") {
        const mime =
          typeof best.mimeType === "string"
            ? String(best.mimeType).split(";")[0]
            : "audio/mp4";
        return { url: best.url, mimeType: mime };
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : "player error";
    }
  }
  return { error: lastError };
}

async function pipeRemoteAudio(
  audioUrl: string,
  res: Response,
  mimeType: string,
  videoId: string,
): Promise<void> {
  const upstream = await fetch(audioUrl, {
    headers: {
      "User-Agent":
        "com.google.ios.youtube/21.03.1 (iPhone16,2; U; CPU iOS 18_2 like Mac OS X;)",
      Referer: `${YTM_ORIGIN}/`,
    },
  });
  if (!upstream.ok || !upstream.body) {
    res.status(502).json({
      ok: false,
      error: `Upstream audio ${upstream.status}`,
    });
    return;
  }
  const ctype = upstream.headers.get("content-type") || mimeType;
  res.status(200);
  res.setHeader("Content-Type", ctype);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${videoId}.m4a"`,
  );
  res.setHeader("Cache-Control", "private, max-age=3600");
  const len = upstream.headers.get("content-length");
  if (len) res.setHeader("Content-Length", len);

  const reader = upstream.body.getReader();
  const pump = async (): Promise<void> => {
    const { done, value } = await reader.read();
    if (done) {
      res.end();
      return;
    }
    if (!res.write(Buffer.from(value))) {
      await new Promise<void>((resolve) => res.once("drain", resolve));
    }
    await pump();
  };
  await pump();
}

async function handleAudioDownload(req: Request, res: Response): Promise<void> {
  setYtmCors(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  const videoId = String(req.query.videoId || "").trim();
  if (!/^[\w-]{11}$/.test(videoId)) {
    res.status(400).json({ ok: false, error: "videoId inválido" });
    return;
  }
  try {
    const resolved = await resolveAudioUrl(videoId);
    if ("error" in resolved) {
      res.status(502).json({
        ok: false,
        error:
          resolved.error ||
          "YouTube no entregó stream descargable desde el servidor",
      });
      return;
    }
    await pipeRemoteAudio(resolved.url, res, resolved.mimeType, videoId);
  } catch (e) {
    res.status(502).json({
      ok: false,
      error: e instanceof Error ? e.message : "audio download error",
    });
  }
}

async function handleMediaProxy(req: Request, res: Response): Promise<void> {
  setYtmCors(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  const raw = String(req.query.url || "");
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    res.status(400).json({ ok: false, error: "url inválida" });
    return;
  }
  if (
    !target.hostname.endsWith("googlevideo.com") &&
    !target.hostname.endsWith("googleusercontent.com")
  ) {
    res.status(400).json({ ok: false, error: "host no permitido" });
    return;
  }
  try {
    await pipeRemoteAudio(target.toString(), res, "audio/mp4", "media");
  } catch (e) {
    res.status(502).json({
      ok: false,
      error: e instanceof Error ? e.message : "media proxy error",
    });
  }
}

async function proxyYtm(req: Request, res: Response): Promise<void> {
  setYtmCors(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET" && req.method !== "POST" && req.method !== "HEAD") {
    res.status(405).json({ ok: false, error: "method not allowed" });
    return;
  }

  try {
    const suffix = String(req.path || "/").replace(/^\/+/, "");
    const qs = new URLSearchParams(
      Object.entries(req.query).flatMap(([k, v]) => {
        if (v == null) return [];
        if (Array.isArray(v)) return v.map((item) => [k, String(item)]);
        return [[k, String(v)]];
      }),
    ).toString();
    const target = `${YTM_ORIGIN}/${suffix}${qs ? `?${qs}` : ""}`;

    const headers: Record<string, string> = {
      "Content-Type": req.get("content-type") || "application/json",
      Accept: "application/json",
      "User-Agent":
        req.get("user-agent") ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0",
      Origin: YTM_ORIGIN,
      Referer: `${YTM_ORIGIN}/`,
      "X-Goog-Api-Format-Version": req.get("x-goog-api-format-version") || "1",
    };
    const clientName = req.get("x-youtube-client-name");
    const clientVersion = req.get("x-youtube-client-version");
    if (clientName) headers["X-YouTube-Client-Name"] = clientName;
    if (clientVersion) headers["X-YouTube-Client-Version"] = clientVersion;

    const upstream = await fetch(target, {
      method: req.method === "HEAD" ? "GET" : req.method,
      headers,
      body:
        req.method === "GET" || req.method === "HEAD"
          ? undefined
          : JSON.stringify(req.body ?? {}),
    });

    const text = await upstream.text();
    res.status(upstream.status);
    const ctype = upstream.headers.get("content-type");
    if (ctype) res.setHeader("Content-Type", ctype);
    res.setHeader("Cache-Control", "public, max-age=30");
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.send(text);
  } catch (e) {
    res.status(502).json({
      ok: false,
      error: e instanceof Error ? e.message : "ytm proxy error",
    });
  }
}

export function mountRichardflixYtm(router: Router): void {
  router.options("/ytm/audio", (req, res) => {
    void handleAudioDownload(req, res);
  });
  router.get("/ytm/audio", (req, res) => {
    void handleAudioDownload(req, res);
  });
  router.options("/ytm/media", (req, res) => {
    void handleMediaProxy(req, res);
  });
  router.get("/ytm/media", (req, res) => {
    void handleMediaProxy(req, res);
  });
  router.use("/ytm", (req, res) => {
    void proxyYtm(req, res);
  });
}
