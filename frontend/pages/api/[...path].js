import { timingSafeEqual } from "node:crypto";

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Метод не поддерживается" });
  }
  if (req.method === "POST") {
    const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
      req.socket.remoteAddress,
    );
    let host;
    try {
      host = new URL(`http://${req.headers.host}`).hostname;
    } catch {
      return res.status(400).json({ error: "Некорректный адрес сервера" });
    }
    const origin = req.headers.origin;
    const sameOrigin =
      !origin ||
      origin === `http://${req.headers.host}` ||
      origin === `https://${req.headers.host}`;
    const supplied = (req.headers.authorization || "").replace(/^Bearer /, "");
    const token = process.env.SCRAPER_TOKEN;
    const authorized =
      token &&
      Buffer.byteLength(supplied) === Buffer.byteLength(token) &&
      timingSafeEqual(Buffer.from(supplied), Buffer.from(token));
    if (
      !(
        local &&
        ["localhost", "127.0.0.1", "[::1]"].includes(host) &&
        sameOrigin
      ) &&
      !authorized
    ) {
      return res.status(403).json({
        error: "Для удалённого управления сбором требуется SCRAPER_TOKEN",
      });
    }
  }
  const { path, ...query } = req.query;
  const segments = Array.isArray(path) ? path : [path];
  const allowed =
    /^(?:health|overview|products|categories(?:\/[1-9]\d*)?|scrape(?:\/status|\/cancel)?)$/;
  if (!allowed.test(segments.join("/")))
    return res.status(404).json({ error: "Адрес API не найден" });
  const base = process.env.BACKEND_URL || "http://127.0.0.1:5000";
  const url = new URL(`/api/${segments.join("/")}`, base);
  for (const [key, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : [value])
      url.searchParams.append(key, item);
  }
  try {
    const response = await fetch(url, {
      method: req.method,
      signal: AbortSignal.timeout(20_000),
      headers: {
        "Content-Type": "application/json",
        ...(req.headers.authorization
          ? { Authorization: req.headers.authorization }
          : {}),
      },
      body:
        req.method === "POST"
          ? JSON.stringify(req.body === "" || req.body == null ? {} : req.body)
          : undefined,
    });
    const data = await response.json();
    res.setHeader("Cache-Control", "no-store");
    return res.status(response.status).json(data);
  } catch {
    return res.status(502).json({
      error: "Backend недоступен. Запустите приложение командой npm run dev.",
    });
  }
}
