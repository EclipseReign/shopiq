import { createClient } from "@supabase/supabase-js";

export function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}

export function database(env: Env, token?: string) {
  return createClient(
    env.SUPABASE_URL,
    token ? env.SUPABASE_PUBLISHABLE_KEY : env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            signal: init?.signal
              ? AbortSignal.any([init.signal, AbortSignal.timeout(30000)])
              : AbortSignal.timeout(30000),
          }),
      },
    },
  );
}

export function value<T>(result: { data: T; error: any }): NonNullable<T> {
  if (result.error) {
    console.error(
      JSON.stringify({ event: "database_error", code: result.error.code }),
    );
    if (result.error.code === "23505") fail(409, "Такая запись уже существует");
    if (result.error.code === "P0001") fail(409, result.error.message);
    if (result.error.code === "PGRST116") fail(404, "Запись не найдена");
    fail(503, "Хранилище временно недоступно. Повторите запрос.");
  }
  return result.data!;
}

export async function identity(request: Request, env: Env) {
  const token = request.headers
    .get("Authorization")
    ?.match(/^Bearer (.+)$/)?.[1];
  if (!token || token.length > 16000) fail(401, "Войдите в аккаунт");
  const client = database(env, token);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user || !data.user.email_confirmed_at)
    fail(401, "Подтвердите email и войдите снова");
  return {
    user: data.user,
    client,
    admin: data.user.email?.toLowerCase() === env.ADMIN_EMAIL.toLowerCase(),
  };
}

export async function body(request: Request, maxBytes = 16384) {
  if (
    !request.headers
      .get("Content-Type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    fail(415, "Ожидается JSON");
  if (Number(request.headers.get("Content-Length")) > maxBytes)
    fail(413, "Запрос превышает допустимый размер");
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value: chunk, done } = await reader.read();
    if (done) break;
    size += chunk.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      fail(413, "Запрос превышает допустимый размер");
    }
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object")
      fail(400, "Ожидается объект JSON");
    return parsed;
  } catch {
    fail(400, "Некорректный JSON");
  }
}

export function uuid(input: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input,
    )
  )
    fail(400, "Некорректный ID");
  return input;
}

export function positive(input: unknown, fallback: number, max = 2147483647) {
  if (input === undefined || input === null || input === "") return fallback;
  if (
    !["number", "string"].includes(typeof input) ||
    !/^[1-9]\d*$/.test(String(input)) ||
    Number(input) > max
  )
    fail(400, "Некорректный числовой параметр");
  return Number(input);
}

export async function digest(text: string) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function security(response: Response, supabaseUrl: string, xml = false) {
  const result = new Response(response.body, response);
  result.headers.set("X-Content-Type-Options", "nosniff");
  result.headers.set("Referrer-Policy", "no-referrer");
  result.headers.set("X-Frame-Options", "DENY");
  result.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  result.headers.set("Strict-Transport-Security", "max-age=31536000");
  result.headers.set(
    "Content-Security-Policy",
    xml
      ? "default-src 'none'; frame-ancestors 'none'; sandbox"
      : `default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; style-src-attr 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://resources.cdn-kaspi.kz https://*.cdn-kaspi.kz; connect-src 'self' ${supabaseUrl}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`,
  );
  return result;
}
