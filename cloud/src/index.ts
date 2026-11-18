import { fetchOffers } from "../../shared/kaspi.mjs";
export { KaspiSource } from "./source";
import { sourceOptions } from "./source";
import {
  database,
  value,
  identity,
  body,
  positive,
  fail,
  json,
  security,
} from "./core";
import { merchantRoute, feedResponse, runMerchantJob } from "./merchant";
import {
  coverage,
  startCollection,
  collectionStatus,
  collectPage,
  discover,
  resumePending,
  rows,
} from "./collector";

function catalogFilters(url: URL) {
  for (const key of new Set(url.searchParams.keys()))
    if (url.searchParams.getAll(key).length > 1)
      fail(400, "Повторяющийся параметр запроса");
  const params = Object.fromEntries(url.searchParams);
  for (const key of ["categoryId", "page", "pageSize"])
    if (params[key])
      positive(
        params[key],
        1,
        key === "pageSize" ? 100 : key === "page" ? 1000000 : 2147483647,
      );
  if (
    (params.search || "").length > 200 ||
    (params.cityId && !/^\d{9}$/.test(params.cityId))
  )
    fail(400, "Проверьте поисковый запрос и город");
  for (const key of ["dateFrom", "dateTo"]) {
    const date = params[key];
    if (
      date &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(date)) ||
        new Date(date).toISOString().slice(0, 10) !== date)
    )
      fail(400, "Некорректная дата");
  }
  if (params.dateFrom && params.dateTo && params.dateFrom > params.dateTo)
    fail(400, "Проверьте порядок дат");
  if (
    params.sort &&
    !["default", "price-asc", "price-desc", "rating", "reviews"].includes(
      params.sort,
    )
  )
    fail(400, "Неизвестная сортировка");
  return params;
}

async function api(request: Request, env: Env, url: URL) {
  const path = url.pathname.slice(5).split("/").filter(Boolean);
  const client = database(env);
  if (request.method === "GET" && path[0] === "config")
    return json({
      cloud: true,
      supabaseUrl: env.SUPABASE_URL,
      supabaseKey: env.SUPABASE_PUBLISHABLE_KEY,
    });
  if (request.method === "GET" && path[0] === "health") {
    value(await client.from("categories").select("id").limit(1));
    return json({ status: "ok" });
  }
  if (path[0] === "me") {
    const auth = await identity(request, env);
    return json({
      user: { id: auth.user.id, email: auth.user.email },
      admin: auth.admin,
    });
  }
  if (path[0] === "stores") return merchantRoute(request, env, path, url);
  if (path[0] === "offers" && request.method === "GET") {
    if (
      !/^\d{1,20}$/.test(path[1] || "") ||
      (url.searchParams.get("cityId") &&
        !/^\d{9}$/.test(url.searchParams.get("cityId")!))
    )
      fail(400, "Проверьте ID товара и город");
    const page = Number(url.searchParams.get("page") || 0);
    const pageSize = positive(url.searchParams.get("pageSize"), 50, 50);
    if (!Number.isSafeInteger(page) || page < 0 || page > 10000)
      fail(400, "Некорректная страница предложений");
    return json(
      await fetchOffers(
        path[1],
        url.searchParams.get("cityId") || "750000000",
        { ...sourceOptions(env), page, pageSize },
      ),
    );
  }
  if (request.method === "GET") {
    const filters = catalogFilters(url);
    if (path[0] === "products")
      return json(value(await client.rpc("catalog_products", { p: filters })));
    if (path[0] === "overview")
      return json(value(await client.rpc("catalog_overview", { p: filters })));
    if (path[0] === "categories") {
      if (!path[1])
        return json(
          value(
            await client.rpc("catalog_categories", {
              parent: filters.parentId ? positive(filters.parentId, 1) : null,
            }),
          ),
        );
      const category = value(
        await client.rpc("catalog_category", {
          category: positive(path[1], 1),
        }),
      );
      if (!category) fail(404, "Категория не найдена");
      return json(category);
    }
    if (path[0] === "coverage") return json(await coverage(env));
    if (path[0] === "scrape" && path[1] === "status")
      return json(await collectionStatus(env));
  }
  if (path[0] === "scrape" && request.method === "POST") {
    const auth = await identity(request, env);
    if (!auth.admin)
      fail(403, "Управление общим сбором доступно администратору");
    if (path[1] === "cancel") {
      value(
        await client
          .from("collection_runs")
          .update({
            status: "cancelled",
            finished_at: new Date().toISOString(),
          })
          .eq("status", "running"),
      );
      return json(await collectionStatus(env));
    }
    const input = await body(request);
    if (path[1] === "discover") {
      const cityId = String(input.cityId || "750000000");
      if (!/^\d{9}$/.test(cityId)) fail(400, "Некорректный город");
      await env.JOBS.send({ kind: "discovery", cityId });
      return json({ queued: true }, 202);
    }
    if (!path[1])
      return json(await startCollection(env, input, auth.user.id), 202);
  }
  fail(404, "Адрес API не найден");
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/feeds/")) {
        const ip = request.headers.get("CF-Connecting-IP") || "local";
        if (!(await env.API_LIMITER.limit({ key: `feed:${ip}` })).success)
          fail(429, "Слишком много запросов. Повторите через минуту.");
        if (!["GET", "HEAD"].includes(request.method))
          fail(405, "Метод не поддерживается");
        const token = url.pathname.match(/^\/feeds\/([a-f0-9]{64})\.xml$/)?.[1];
        if (!token) fail(404, "Прайс не найден");
        return security(
          await feedResponse(env, token, request),
          env.SUPABASE_URL,
          true,
        );
      }
      if (!url.pathname.startsWith("/api/"))
        return security(await env.ASSETS.fetch(request), env.SUPABASE_URL);
      const ip = request.headers.get("CF-Connecting-IP") || "local";
      if (!(await env.API_LIMITER.limit({ key: ip })).success)
        fail(429, "Слишком много запросов. Повторите через минуту.");
      if (request.method !== "GET" || url.pathname.startsWith("/api/offers/")) {
        if (!(await env.EXPENSIVE_LIMITER.limit({ key: ip })).success)
          fail(429, "Лимит операций достигнут. Повторите через минуту.");
      }
      if (!["GET", "HEAD"].includes(request.method)) {
        const origin = request.headers.get("Origin");
        if (origin && origin !== url.origin)
          fail(403, "Запрос с другого сайта запрещён");
      }
      // Only shared market data uses the edge cache. Merchant responses carry no-store.
      const publicRead =
        request.method === "GET" &&
        /^\/api\/(?:products|overview|categories|coverage|offers)(?:\/|$)/.test(
          url.pathname,
        );
      const cacheKey = new Request(url.toString(), { method: "GET" });
      if (publicRead) {
        const cached = await caches.default.match(cacheKey);
        if (cached) return security(cached, env.SUPABASE_URL);
      }
      const response = await api(request, env, url);
      if (publicRead && response.ok) {
        response.headers.set("Cache-Control", "public, max-age=30");
        ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
      }
      return security(response, env.SUPABASE_URL);
    } catch (error) {
      const status = error.name==='UpstreamError'
        ? [429,503].includes(error.status) ? 503 : 502
        : error.status >= 400 && error.status < 600 ? error.status : 500;
      if (status >= 500)
        console.error(
          JSON.stringify({ event: "request_failed", name: error.name, status }),
        );
      const response = json(
        {
          error:
            status < 500
              ? error.message
              : "Сервис временно недоступен. Повторите запрос.",
        },
        status,
      );
      if (status === 429) response.headers.set("Retry-After", "60");
      return security(response, env.SUPABASE_URL);
    }
  },
  async queue(batch: MessageBatch<any>, env: Env) {
    for (const message of batch.messages) {
      try {
        const job = message.body;
        if (job.kind === "category") await collectPage(env, job);
        else if (job.kind === "merchant") await runMerchantJob(env, job.id);
        else if (job.kind === "discovery") await discover(env, job.cityId);
        else throw new Error("Unknown job");
        message.ack();
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "job_failed",
            kind: message.body.kind,
            attempt: message.attempts,
            status: error.status || 0,
          }),
        );
        if (message.attempts >= 4) {
          const client = database(env);
          if (message.body.kind === "category") {
            value(
              await client
                .from("collection_tasks")
                .update({
                  status: "failed",
                  error:
                    "Источник недоступен или изменился. Запустите повторную проверку.",
                  updated_at: new Date().toISOString(),
                })
                .eq("run_id", message.body.runId)
                .eq("category_id", message.body.categoryId),
            );
            value(
              await client.rpc("collection_progress", {
                run: message.body.runId,
              }),
            );
          }
          if (message.body.kind === "merchant")
            value(
              await client
                .from("merchant_jobs")
                .update({ status: "failed", lease_until: null })
                .eq("id", message.body.id),
            );
        }
        message.retry({
          delaySeconds: Math.min(
            43200,
            Math.max(error.retryAfter || 0, 30 * 2 ** (message.attempts - 1)),
          ),
        });
      }
    }
  },
  async scheduled(_event: ScheduledController, env: Env) {
    const client = database(env);
    const period = new Date().toISOString().slice(0, 13);
    const rules = await rows(
      client
        .from("price_rules")
        .select("id")
        .eq("enabled", true)
        .eq("auto_enabled", true)
        .order("id"),
    );
    for (let offset = 0; offset < rules.length; offset += 300)
      value(
        await client.from("merchant_jobs").upsert(
          rules
            .slice(offset, offset + 300)
            .map((rule) => ({ rule_id: rule.id, period })),
          { onConflict: "rule_id,period", ignoreDuplicates: true },
        ),
      );
    const pending = value(
      await client
        .from("merchant_jobs")
        .select("id")
        .or(
          `status.eq.pending,and(status.eq.running,lease_until.lt.${new Date().toISOString()})`,
        )
        .limit(1000),
    );
    for (let offset = 0; offset < pending.length; offset += 100)
      await env.JOBS.sendBatch(
        pending
          .slice(offset, offset + 100)
          .map((job) => ({ body: { kind: "merchant", id: job.id } })),
      );
    await resumePending(env);
  },
} satisfies ExportedHandler<Env>;
