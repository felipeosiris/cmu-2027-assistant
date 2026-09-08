/**
 * RichardFlix Music — proxy YouTube Music InnerTube (mismo patrón que FridaMusic).
 * POST/GET /rf/ytm/youtubei/v1/{search|browse|player|...}
 */
import type { Request, Response, Router } from "express";

const YTM_ORIGIN = "https://music.youtube.com";

function setYtmCors(res: Response): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Accept, Content-Type, X-Goog-Api-Format-Version, X-YouTube-Client-Name, X-YouTube-Client-Version, User-Agent",
  );
  res.setHeader("Access-Control-Max-Age", "86400");
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
  router.use("/ytm", (req, res) => {
    void proxyYtm(req, res);
  });
}
