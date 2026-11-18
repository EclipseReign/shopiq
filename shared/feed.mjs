import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

export const MAX_FEED_BYTES = 8 * 1024 * 1024;

function elements(node, name) {
  return Array.from(node.childNodes || []).filter(
    (child) => child.nodeType === 1 && child.localName === name,
  );
}

function single(node, name, required = true) {
  const children = elements(node, name);
  if (children.length > 1 || (required && children.length !== 1))
    throw new Error(`Проверьте единственный элемент ${name}`);
  return children[0];
}

function price(node) {
  const text = node.textContent.trim();
  const value = Number(text);
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(value) || value > 1e12)
    throw new Error(
      "Цена в XML должна быть положительным целым числом в тенге",
    );
  return value;
}

export function parseFeed(xml, expectedMerchantId) {
  if (
    typeof xml !== "string" ||
    new TextEncoder().encode(xml).byteLength > MAX_FEED_BYTES
  )
    throw new Error("Максимальный размер XML составляет 8 МБ");
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml))
    throw new Error("DTD и внешние сущности в прайс-листе запрещены");
  let document;
  try {
    document = new DOMParser({
      onError: (level, message) => {
        throw new Error(message);
      },
    }).parseFromString(xml, "application/xml");
  } catch {
    throw new Error("XML содержит синтаксическую ошибку");
  }
  const root = document.documentElement;
  if (
    !root ||
    root.localName !== "kaspi_catalog" ||
    !["", "kaspiShopping", null].includes(root.namespaceURI)
  )
    throw new Error("Ожидается XML-прайс Kaspi с корнем kaspi_catalog");
  let count = 0;
  const stack = [[root, 0]];
  while (stack.length) {
    const [node, depth] = stack.pop();
    if (++count > 400000 || depth > 24)
      throw new Error("XML превышает допустимую сложность");
    for (const child of Array.from(node.childNodes || []))
      stack.push([child, depth + 1]);
  }
  const merchantId = single(root, "merchantid").textContent.trim();
  const company = single(root, "company").textContent.trim();
  if (!merchantId || merchantId !== String(expectedMerchantId))
    throw new Error(
      "merchantid в XML должен совпадать с ID подключённого магазина",
    );
  const offersRoot = single(root, "offers");
  const nodes = elements(offersRoot, "offer");
  if (!nodes.length) throw new Error("XML не содержит товаров");
  const seen = new Set();
  const offers = nodes.map((node) => {
    const sku = node.getAttribute("sku");
    if (!sku || sku.length > 128 || seen.has(sku))
      throw new Error("Каждый товар должен иметь уникальный SKU");
    seen.add(sku);
    const model = single(node, "model").textContent.trim();
    if (!model) throw new Error(`Пустое название товара ${sku}`);
    const common = single(node, "price", false);
    const citiesRoot = single(node, "cityprices", false);
    if (Boolean(common) === Boolean(citiesRoot))
      throw new Error(`Для ${sku} нужен price или cityprices`);
    const prices = {};
    if (common) prices["*"] = price(common);
    else {
      for (const city of elements(citiesRoot, "cityprice")) {
        const id = city.getAttribute("cityId");
        if (!/^\d{9}$/.test(id || "") || Object.hasOwn(prices, id))
          throw new Error(`Проверьте цены по городам для ${sku}`);
        prices[id] = price(city);
      }
      if (!Object.keys(prices).length)
        throw new Error(`Отсутствуют цены по городам для ${sku}`);
    }
    return {
      sku,
      model,
      brand: single(node, "brand", false)?.textContent.trim() || null,
      prices,
    };
  });
  return { document, root, nodes, merchantId, company, offers };
}

export function renderFeed(xml, merchantId, overrides = {}, updatedAt) {
  const parsed = parseFeed(xml, merchantId);
  for (let index = 0; index < parsed.nodes.length; index++) {
    const node = parsed.nodes[index];
    const offer = parsed.offers[index];
    for (const cityId of Object.keys(offer.prices)) {
      const value = Object.hasOwn(overrides, offer.sku)
        ? overrides[offer.sku]?.[cityId]
        : undefined;
      if (value === undefined) continue;
      if (!Number.isSafeInteger(value) || value < 1 || value > 1e12)
        throw new Error("Некорректная опубликованная цена");
      const target =
        cityId === "*"
          ? single(node, "price")
          : elements(single(node, "cityprices"), "cityprice").find(
              (city) => city.getAttribute("cityId") === cityId,
            );
      target.textContent = String(value);
    }
  }
  if (updatedAt) parsed.root.setAttribute("date", updatedAt);
  return new XMLSerializer({ requireWellFormed: true }).serializeToString(
    parsed.document,
  );
}
