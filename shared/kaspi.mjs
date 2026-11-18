const ORIGIN = "https://kaspi.kz";

export class UpstreamError extends Error {
  constructor(message, status = 0, retryAfter = 0) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export function normalizeKaspiUrl(value, kind = null) {
  if (typeof value !== "string") throw new Error("Отсутствует ссылка Kaspi");
  let path = value;
  if (path.startsWith("c/") || path.startsWith("l/") || path.startsWith("p/"))
    path = "/shop/" + path;
  if (/^\/(?:c|l|p)\//.test(path)) path = "/shop" + path;
  const url = new URL(path, ORIGIN);
  if (
    url.origin !== ORIGIN ||
    url.username ||
    url.password ||
    !url.pathname.startsWith("/shop/")
  )
    throw new Error("Некорректная ссылка Kaspi");
  if (kind && !url.pathname.startsWith(`/shop/${kind}/`))
    throw new Error("Неверный тип ссылки Kaspi");
  return `${ORIGIN}${url.pathname}`;
}

export function normalizeNavigation(tree) {
  if (!tree || typeof tree !== "object" || !Array.isArray(tree.subNodes))
    throw new Error("Kaspi вернул неизвестный формат дерева категорий");
  const nodes = [];
  const codes = new Set();
  function visit(node, parentCode, level) {
    const code = typeof node.code === "string" ? node.code.trim() : "";
    const name =
      typeof node.titleRu === "string"
        ? node.titleRu.trim()
        : String(node.title || "").trim();
    if (!code || !name || codes.has(code))
      throw new Error("Повтор или пустой код в дереве Kaspi");
    codes.add(code);
    let rawUrl = node.link;
    let repaired = false;
    if (
      typeof rawUrl !== "string" ||
      !/^(?:https:\/\/kaspi\.kz)?\/?(?:shop\/)?[cl]\//.test(rawUrl)
    ) {
      rawUrl = "/shop/c/" + encodeURIComponent(code.toLowerCase()) + "/";
      repaired = true;
    }
    const url = normalizeKaspiUrl(rawUrl);
    const children = Array.isArray(node.subNodes) ? node.subNodes : [];
    nodes.push({
      code,
      name,
      url,
      parent_code: parentCode,
      level,
      is_leaf: children.length === 0,
      visible: node.visible !== false,
      source_link_repaired: repaired,
    });
    for (const child of children) visit(child, code, level + 1);
  }
  for (const node of tree.subNodes) visit(node, null, 0);
  if (!nodes.length) throw new Error("Дерево категорий Kaspi пустое");
  return nodes;
}

function optionalNumber(value, max) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= max
    ? parsed
    : null;
}

export function normalizeProduct(raw, categoryId, cityId) {
  const externalId = String(raw?.id ?? "");
  const name = typeof raw?.title === "string" ? raw.title.trim() : "";
  const price =
    optionalNumber(raw?.unitSalePrice, 1e12) ||
    optionalNumber(raw?.unitPrice, 1e12) ||
    null;
  if (!/^\d+$/.test(externalId) || !name)
    throw new Error("В карточке Kaspi отсутствует ID или название");
  if (raw.currency && raw.currency !== "KZT")
    throw new Error("Неожиданная валюта карточки Kaspi");
  const reviews = optionalNumber(raw.reviewsQuantity, Number.MAX_SAFE_INTEGER);
  const image = Array.isArray(raw.previewImages) ? raw.previewImages[0] : null;
  return {
    external_id: externalId,
    product_key: `kaspi:${externalId}`,
    category_id: categoryId,
    category_codes: Array.isArray(raw.categoryCodes)
      ? raw.categoryCodes.filter(
          (code) => typeof code === "string" && code !== "Categories",
        )
      : [],
    city_id: cityId,
    name,
    brand:
      typeof raw.brand === "string" && raw.brand.trim()
        ? raw.brand.trim()
        : null,
    price: raw.priceFormatted || (price === null ? null : `${price} ₸`),
    parsed_price: price,
    rating: optionalNumber(raw.rating, 5) || null,
    reviews_count:
      reviews !== null && Number.isSafeInteger(reviews) ? reviews : null,
    image_url: image?.large || image?.medium || image?.small || null,
    product_url: normalizeKaspiUrl(raw.shopLink, "p"),
  };
}

async function boundedJSON(response, maxBytes = 16 * 1024 * 1024) {
  if (Number(response.headers.get("content-length")) > maxBytes)
    throw new Error("Ответ источника превышает допустимый размер");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Источник вернул пустой ответ");
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes)
        throw new Error("Ответ источника превышает допустимый размер");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(buffer));
  } catch {
    throw new Error("Источник вернул некорректный JSON");
  }
}

export async function requestKaspi(
  path,
  cityId,
  { signal, fetcher = fetch, timeoutMs = 30000, body } = {},
) {
  if (!/^\d{9}$/.test(String(cityId)))
    throw new Error("Некорректный код города");
  const url = new URL(path, ORIGIN);
  if (url.origin !== ORIGIN || !url.pathname.startsWith("/yml/"))
    throw new Error("Некорректный адрес источника");
  const response = await fetcher(url, {
    method: body ? "POST" : "GET",
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      Accept: "application/json",
      "X-KS-City": String(cityId),
      Referer: `${ORIGIN}/shop/?c=${cityId}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const header = response.headers.get("retry-after");
    const seconds = Number(header);
    const retryAfter =
      Number.isFinite(seconds) && seconds > 0
        ? seconds
        : Math.max(0, (Date.parse(header || "") - Date.now()) / 1000) || 0;
    throw new UpstreamError(
      `Kaspi вернул HTTP ${response.status}`,
      response.status,
      retryAfter,
    );
  }
  return boundedJSON(response);
}

export async function fetchOffers(externalId, cityId, options = {}) {
  const page = options.page ?? 0;
  const limit = options.pageSize ?? 50;
  if (
    !Number.isSafeInteger(page) ||
    page < 0 ||
    page > 10000 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 50
  )
    throw new Error("Некорректная страница предложений");
  if (!/^\d{1,20}$/.test(String(externalId)))
    throw new Error("Некорректный ID карточки Kaspi");
  const result = await requestKaspi(
    `/yml/offer-view/offers/${externalId}`,
    cityId,
    {
      ...options,
      body: {
        cityId: String(cityId),
        id: String(externalId),
        merchantUID: [],
        limit,
        page,
        sortOption: "PRICE",
        highRating: null,
        searchText: null,
        isExcellentMerchant: false,
        zoneId: [],
        installationId: "-1",
      },
    },
  );
  if (
    !Array.isArray(result.offers) ||
    !Number.isSafeInteger(result.total) ||
    result.total < 0
  )
    throw new UpstreamError("Изменился формат предложений продавцов Kaspi");
  const offers = result.offers.map((offer) => {
    const merchantId = String(offer.merchantId || "");
    const price = Number(offer.price);
    if (!merchantId || !Number.isSafeInteger(price) || price < 1)
      throw new UpstreamError(
        "Предложение продавца содержит некорректную цену или ID",
      );
    return {
      merchant_id: merchantId,
      merchant_name: String(offer.merchantName || merchantId),
      merchant_sku: String(offer.merchantSku || ""),
      price,
      rating: optionalNumber(offer.merchantRating, 5),
      reviews: optionalNumber(
        offer.merchantReviewsQuantity,
        Number.MAX_SAFE_INTEGER,
      ),
      available: true,
    };
  });
  // PRICE is the source's ascending-price order. A bounded first page contains
  // the cheapest competitors without downloading every seller's full catalog.
  if (
    offers.some(
      (offer, index) => index > 0 && offer.price < offers[index - 1].price,
    )
  )
    throw new UpstreamError(
      "Источник изменил порядок цен. Расчёт приостановлен",
    );
  if (page * limit < result.total && !offers.length)
    throw new UpstreamError(
      "Источник вернул пустые предложения при ненулевом количестве",
    );
  return {
    offers,
    external_id: String(externalId),
    page,
    pageSize:
      page === 0 &&
      offers.length > 0 &&
      offers.length < limit &&
      result.total > offers.length
        ? offers.length
        : limit,
    hasMore:
      page === 0
        ? offers.length < result.total
        : (page + 1) * limit < result.total,
    total: result.total,
    observed_at:
      typeof result._shopiq_observed_at === "string" &&
      Number.isFinite(Date.parse(result._shopiq_observed_at))
        ? result._shopiq_observed_at
        : new Date().toISOString(),
    city_id: String(cityId),
  };
}

export async function fetchNavigation(cityId, options) {
  const query = new URLSearchParams({
    depth: "8",
    city: String(cityId),
    code: "",
    rootType: "desktop",
  });
  const tree = await requestKaspi(
    `/yml/main-navigation/n/n/desktop-menu?${query}`,
    cityId,
    { timeoutMs: 90000, ...options },
  );
  return normalizeNavigation(tree);
}

export async function fetchCategoryPage(code, cityId, page = 0, options = {}) {
  if (
    typeof code !== "string" ||
    !code.trim() ||
    !Number.isSafeInteger(page) ||
    page < 0
  )
    throw new Error("Некорректная категория или страница");
  let pageInfo = options.pageInfo;
  let cards;
  let facets = [];
  if (
    !pageInfo ||
    page === 0 ||
    (page + 1) * pageInfo.pageSize >= pageInfo.total
  ) {
    const query = new URLSearchParams({
      c: String(cityId),
      q: `:category:${code}`,
      page: "0",
      sort: "created-desc",
      all: "false",
      fl: "true",
      ui: "d",
      i: "-1",
    });
    const response = await requestKaspi(
      `/yml/product-view/pl/filters?${query}`,
      cityId,
      options,
    );
    const data = response?.data;
    if (!data || !Array.isArray(data.cards))
      throw new UpstreamError(
        "Источник перенаправил категорию или изменил формат выдачи",
      );
    pageInfo = {
      total: Number(data.total),
      pageSize: Number(data.limit),
      invisibleFilters: data.invisibleFilters || "",
      categoryQuery: data.filterCategory || `:category:${code}`,
    };
    if (page === 0) cards = data.cards;
    facets = Array.isArray(data.filters) ? data.filters : [];
  }
  const { total, pageSize } = pageInfo;
  if (
    !Number.isSafeInteger(total) ||
    total < 0 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1
  )
    throw new UpstreamError("Источник не сообщил размер каталога и страницы");
  if (!cards) {
    const query = new URLSearchParams({
      c: String(cityId),
      q: pageInfo.invisibleFilters + pageInfo.categoryQuery,
      page: String(page),
      sort: "created-desc",
      text: "",
      qs: "",
      ui: "d",
      i: "-1",
    });
    const response = await requestKaspi(
      `/yml/product-view/pl/results?${query}`,
      cityId,
      options,
    );
    if (!Array.isArray(response?.data))
      throw new UpstreamError("Изменился формат страницы товаров Kaspi");
    cards = response.data;
  }
  if (cards.length === 0 && page * pageSize < total)
    throw new UpstreamError(
      "Пустая страница до конца выдачи Kaspi. Требуется повторная проверка",
    );
  if (cards.length > pageSize)
    throw new UpstreamError(
      "Источник изменил размер страницы. Требуется повторная проверка пагинации",
    );
  return {
    cards,
    total,
    pageSize,
    page,
    hasMore: (page + 1) * pageSize < total,
    filters: facets,
    pageInfo,
  };
}
