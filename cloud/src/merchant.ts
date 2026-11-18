import { parseFeed, renderFeed, MAX_FEED_BYTES } from "../../shared/feed.mjs";
import { validateRule, proposePrice } from "../../shared/pricing.mjs";
import { fetchOffers } from "../../shared/kaspi.mjs";
import { sourceOptions } from "./source";
import {
  database,
  value,
  fail,
  identity,
  body,
  uuid,
  positive,
  digest,
  json,
} from "./core";

export async function pricePreview(env: Env, ruleId: string) {
  const client = database(env);
  const rule: any = value(
    await client.from("price_rules").select("*").eq("id", ruleId).single(),
  );
  const store: any = value(
    await client.from("stores").select("*").eq("id", rule.store_id).single(),
  );
  const feed: any = value(
    await client
      .from("store_feeds")
      .select("version,snapshot,overrides")
      .eq("store_id", store.id)
      .single(),
  );
  const offer = feed.snapshot.find((item) => item.sku === rule.sku);
  const currentPrice =
    feed.overrides[rule.sku]?.[rule.city_id] ?? offer?.prices[rule.city_id];
  if (currentPrice === undefined)
    fail(409, "SKU или цена для города отсутствуют в текущем прайсе");
  const market = await fetchOffers(
    rule.external_id,
    rule.city_id === "*" ? store.city_id : rule.city_id,
    sourceOptions(env),
  );
  const result = proposePrice({
    rule,
    currentPrice,
    offers: market.offers,
    merchantId: store.merchant_id,
    observedAt: market.observed_at,
  });
  const proposal: any = value(
    await client
      .from("price_changes")
      .insert({
        store_id: store.id,
        rule_id: rule.id,
        sku: rule.sku,
        city_id: rule.city_id,
        feed_version: feed.version,
        rule_updated_at: rule.updated_at,
        current_price: currentPrice,
        suggested_price: result.suggested_price,
        state: result.state,
        details: result,
        observed_at: market.observed_at,
        expires_at: new Date(
          Date.parse(market.observed_at) + 15 * 60000,
        ).toISOString(),
      })
      .select()
      .single(),
  );
  return { proposal, store };
}

export async function merchantRoute(
  request: Request,
  env: Env,
  path: string[],
  url: URL,
) {
  const auth = await identity(request, env);
  const client = auth.client;
  if (path.length === 1) {
    if (request.method === "GET")
      return json({
        stores: value(
          await client
            .from("stores")
            .select("*")
            .order("created_at", { ascending: false }),
        ),
      });
    if (request.method !== "POST") fail(405, "Метод не поддерживается");
    const input = await body(request);
    const name = String(input.name || "").trim();
    const merchantId = String(input.merchantId || "").trim();
    const cityId = String(input.cityId || "750000000");
    if (
      !name ||
      name.length > 120 ||
      !merchantId ||
      merchantId.length > 100 ||
      !/^\d{9}$/.test(cityId)
    )
      fail(400, "Проверьте название, ID магазина и город");
    return json(
      {
        store: value(
          await client
            .from("stores")
            .insert({
              name,
              merchant_id: merchantId,
              city_id: cityId,
              owner_id: auth.user.id,
            })
            .select()
            .single(),
        ),
      },
      201,
    );
  }
  const storeId = uuid(path[1]);
  const store: any = value(
    await client.from("stores").select("*").eq("id", storeId).single(),
  );
  if (path.length === 2 && request.method === "GET") {
    const rulesPage = positive(url.searchParams.get("rulesPage"), 1, 100000);
    const [feedResult, rulesResult, changesResult, jobsResult, autoCount] =
      await Promise.all([
        client
          .from("store_feeds")
          .select("version,snapshot,overrides,updated_at")
          .eq("store_id", storeId)
          .maybeSingle(),
        client
          .from("price_rules")
          .select("*", { count: "exact" })
          .eq("store_id", storeId)
          .order("sku")
          .order("city_id")
          .range((rulesPage - 1) * 25, rulesPage * 25 - 1),
        client
          .from("price_changes")
          .select("*")
          .eq("store_id", storeId)
          .order("created_at", { ascending: false })
          .limit(50),
        database(env)
          .from("merchant_jobs")
          .select("id,status,error,created_at,price_rules!inner(store_id,sku)")
          .eq("price_rules.store_id", storeId)
          .order("created_at", { ascending: false })
          .limit(20),
        client
          .from("price_rules")
          .select("id", { head: true, count: "exact" })
          .eq("store_id", storeId)
          .eq("enabled", true)
          .eq("auto_enabled", true),
      ]);
    const feed: any = value(feedResult);
    const rules = value(rulesResult);
    const changes = value(changesResult);
    const jobs = value(jobsResult);
    value(autoCount);
    const search = (url.searchParams.get("search") || "").trim().toLowerCase();
    if (search.length > 200) fail(400, "Поисковый запрос слишком длинный");
    const page = positive(url.searchParams.get("page"), 1, 100000);
    const products = (feed?.snapshot || []).filter(
      (item) =>
        !search || `${item.sku} ${item.model}`.toLowerCase().includes(search),
    );
    const pageProducts = products.slice((page - 1) * 50, page * 50);
    return json({
      store,
      rules,
      changes,
      jobs,
      rule_pagination: {
        page: rulesPage,
        total: rulesResult.count || 0,
        pages: Math.ceil((rulesResult.count || 0) / 25),
      },
      auto_rules: autoCount.count || 0,
      feed: feed
        ? {
            version: feed.version,
            total: feed.snapshot.length,
            updated_at: feed.updated_at,
            overrides: Object.fromEntries(
              pageProducts
                .filter((item) => Object.hasOwn(feed.overrides, item.sku))
                .map((item) => [item.sku, feed.overrides[item.sku]]),
            ),
          }
        : null,
      products: pageProducts,
      pagination: {
        page,
        total: products.length,
        pages: Math.ceil(products.length / 50),
      },
    });
  }
  if (path[2] === "rules" && path.length === 3 && request.method === "GET") {
    const sku = url.searchParams.get("sku") || "";
    const city = url.searchParams.get("city") || "";
    if (!sku || sku.length > 128 || !(city === "*" || /^\d{9}$/.test(city)))
      fail(400, "Проверьте SKU и город");
    return json({
      rule: value(
        await client
          .from("price_rules")
          .select("*")
          .eq("store_id", storeId)
          .eq("sku", sku)
          .eq("city_id", city)
          .maybeSingle(),
      ),
    });
  }
  if (path[2] === "import" && request.method === "POST") {
    const input = await body(request, MAX_FEED_BYTES * 2 + 1024);
    let parsed;
    try {
      parsed = parseFeed(input.xml, store.merchant_id);
    } catch (error) {
      fail(400, error.message);
    }
    const prior: any = value(
      await client
        .from("store_feeds")
        .select("version,snapshot")
        .eq("store_id", storeId)
        .maybeSingle(),
    );
    const incoming = new Set(parsed.offers.map((item) => item.sku));
    const removed = (prior?.snapshot || [])
      .filter((item) => !incoming.has(item.sku))
      .map((item) => item.sku);
    const confirmed =
      Array.isArray(input.confirmRemoved) &&
      input.confirmRemoved.every((item) => typeof item === "string")
        ? input.confirmRemoved
        : [];
    if (removed.some((sku) => !confirmed.includes(sku)))
      return json(
        {
          error:
            "Новый прайс удаляет товары. Kaspi может снять их с продажи. Подтвердите удаление этих SKU.",
          removed,
        },
        409,
      );
    const result = value(
      await database(env).rpc("import_store_feed", {
        store: storeId,
        actor: auth.user.id,
        xml: input.xml,
        hash: await digest(input.xml),
        items: parsed.offers,
        expected_version: input.expectedVersion,
        removed: confirmed,
      }),
    );
    return json(result);
  }
  if (path[2] === "feed-link" && request.method === "POST") {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const token = Array.from(bytes, (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    value(
      await database(env).rpc("rotate_feed_token", {
        store: storeId,
        actor: auth.user.id,
        hash: await digest(token),
      }),
    );
    return json({ url: `${url.origin}/feeds/${token}.xml` });
  }
  if (path[2] === "rules" && path.length === 3 && request.method === "POST") {
    let rule;
    try {
      rule = validateRule(await body(request));
    } catch (error) {
      fail(400, error.message);
    }
    const feed: any = value(
      await client
        .from("store_feeds")
        .select("snapshot")
        .eq("store_id", storeId)
        .single(),
    );
    if (
      rule.enabled &&
      !feed.snapshot.some(
        (item) =>
          item.sku === rule.sku && Object.hasOwn(item.prices, rule.city_id),
      )
    )
      fail(400, "Импортируйте SKU и цену для выбранного города");
    return json({
      rule: value(
        await client
          .from("price_rules")
          .upsert(
            { ...rule, store_id: storeId },
            { onConflict: "store_id,sku,city_id" },
          )
          .select()
          .single(),
      ),
    });
  }
  if (
    path[2] === "rules" &&
    path[3] &&
    path[4] === "preview" &&
    request.method === "POST"
  ) {
    const rule: any = value(
      await client
        .from("price_rules")
        .select("id")
        .eq("store_id", storeId)
        .eq("id", uuid(path[3]))
        .single(),
    );
    const { proposal } = await pricePreview(env, rule.id);
    return json({ proposal });
  }
  if (path[2] === "changes" && path[3] && request.method === "POST") {
    const change: any = value(
      await client
        .from("price_changes")
        .select("id")
        .eq("store_id", storeId)
        .eq("id", uuid(path[3]))
        .single(),
    );
    if (path[4] === "approve")
      return json({
        proposal: value(
          await database(env).rpc("publish_price_change", {
            change: change.id,
            actor: auth.user.id,
            automatic: false,
          }),
        ),
      });
    if (path[4] === "reject") {
      value(
        await database(env)
          .from("price_changes")
          .update({ state: "rejected" })
          .eq("id", change.id)
          .eq("state", "preview"),
      );
      return json({ ok: true });
    }
  }
  fail(404, "Адрес магазина не найден");
}

export async function feedResponse(env: Env, token: string, request: Request) {
  if (!/^[a-f0-9]{64}$/.test(token)) fail(404, "Прайс не найден");
  const client = database(env);
  const link: any = value(
    await client
      .from("feed_tokens")
      .select("store_id")
      .eq("token_hash", await digest(token))
      .eq("active", true)
      .maybeSingle(),
  );
  if (!link) fail(404, "Прайс не найден");
  const store: any = value(
    await client
      .from("stores")
      .select("merchant_id")
      .eq("id", link.store_id)
      .single(),
  );
  const feed: any = value(
    await client
      .from("store_feeds")
      .select("*")
      .eq("store_id", link.store_id)
      .maybeSingle(),
  );
  if (!feed) fail(404, "Сначала импортируйте прайс");
  const etag = `"${await digest(`${feed.source_hash}:${feed.version}:${feed.updated_at}`)}"`;
  const headers = {
    "Content-Type": "application/xml; charset=utf-8",
    "Cache-Control": "private, no-cache",
    ETag: etag,
    "Last-Modified": new Date(feed.updated_at).toUTCString(),
    "X-Robots-Tag": "noindex, nofollow",
  };
  const matchingTags = request.headers
    .get("If-None-Match")
    ?.split(",")
    .map((tag) => tag.trim().replace(/^W\//, ""));
  if (matchingTags?.includes(etag) || matchingTags?.includes("*"))
    return new Response(null, { status: 304, headers });
  if (request.method === "HEAD") return new Response(null, { headers });
  return new Response(
    renderFeed(
      feed.source_xml,
      store.merchant_id,
      feed.overrides,
      feed.updated_at,
    ),
    { headers },
  );
}

export async function runMerchantJob(env: Env, jobId: string) {
  const client = database(env);
  if (!value(await client.rpc("claim_merchant_job", { job: jobId }))) return;
  const job: any = value(
    await client.from("merchant_jobs").select("*").eq("id", jobId).single(),
  );
  try {
    const rule: any = value(
      await client
        .from("price_rules")
        .select("enabled,auto_enabled")
        .eq("id", job.rule_id)
        .single(),
    );
    if (!rule.enabled || !rule.auto_enabled) {
      value(
        await client
          .from("merchant_jobs")
          .update({ status: "skipped", lease_until: null })
          .eq("id", job.id),
      );
      return;
    }
    const { proposal, store } = await pricePreview(env, job.rule_id);
    if (proposal.state === "preview")
      value(
        await client.rpc("publish_price_change", {
          change: proposal.id,
          actor: store.owner_id,
          automatic: true,
        }),
      );
    value(
      await client
        .from("merchant_jobs")
        .update({
          status: "completed",
          lease_until: null,
          result_id: proposal.id,
          error: null,
        })
        .eq("id", job.id),
    );
  } catch (error) {
    value(
      await client
        .from("merchant_jobs")
        .update({
          status: "pending",
          lease_until: null,
          error: "Не удалось обновить предложения или опубликовать расчёт",
        })
        .eq("id", job.id),
    );
    throw error;
  }
}
