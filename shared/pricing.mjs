function amount(value, name, minimum = 0, maximum = 1e12) {
  if (typeof value === "string" && /^\d+$/.test(value)) value = Number(value);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new Error(`Некорректное поле «${name}»`);
  return value;
}

export function validateRule(input) {
  for (const key of ["enabled", "auto_enabled"]) {
    if (input[key] !== undefined && typeof input[key] !== "boolean")
      throw new Error("Некорректный режим правила");
  }
  const rule = {
    sku: String(input.sku || "").trim(),
    external_id: String(input.external_id || "").trim(),
    city_id: String(input.city_id || "*"),
    min_price: amount(input.min_price, "Минимальная цена", 1),
    max_price: amount(input.max_price, "Максимальная цена", 1),
    cost: amount(input.cost, "Себестоимость"),
    shipping: amount(input.shipping, "Расходы на заказ"),
    commission_bp: amount(input.commission_bp, "Комиссия", 0, 9999),
    tax_bp: amount(input.tax_bp, "Налог", 0, 9999),
    margin_bp: amount(input.margin_bp, "Маржа", 0, 9999),
    step: amount(input.step, "Шаг цены", 1),
    max_change_bp: amount(input.max_change_bp, "Лимит изменения", 1, 10000),
    auto_enabled: input.auto_enabled === true,
    enabled: input.enabled !== false,
  };
  if (
    !rule.sku ||
    rule.sku.length > 128 ||
    !/^\d{1,20}$/.test(rule.external_id) ||
    !(rule.city_id === "*" || /^\d{9}$/.test(rule.city_id))
  )
    throw new Error("Проверьте SKU, ID карточки Kaspi и город");
  if (rule.commission_bp + rule.tax_bp + rule.margin_bp >= 10000)
    throw new Error("Сумма комиссии, налога и маржи должна быть меньше 100%");
  if (rule.max_price < rule.min_price || priceFloor(rule) > rule.max_price)
    throw new Error("Максимальная цена ниже рассчитанной минимальной цены");
  return rule;
}

export function priceFloor(rule) {
  const availableBasisPoints =
    10000 - rule.commission_bp - rule.tax_bp - rule.margin_bp;
  if (availableBasisPoints <= 0)
    throw new Error("Недопустимая сумма процентных расходов");
  // BigInt keeps rounding safe for large prices and narrow margins.
  const numerator = BigInt(rule.cost + rule.shipping) * 10000n;
  const divisor = BigInt(availableBasisPoints);
  const calculated = Number((numerator + divisor - 1n) / divisor);
  return Math.max(rule.min_price, calculated);
}

export function proposePrice({
  rule,
  currentPrice,
  offers,
  merchantId,
  observedAt,
  now = Date.now(),
}) {
  rule = validateRule(rule);
  currentPrice = amount(currentPrice, "Текущая цена", 1);
  const floor = priceFloor(rule);
  const base = {
    current_price: currentPrice,
    floor,
    ceiling: rule.max_price,
    observed_at: observedAt,
    suggested_price: null,
    competitor_price: null,
    reason: "",
    state: "blocked",
  };
  const observed = Date.parse(observedAt);
  if (
    !Number.isFinite(observed) ||
    now - observed > 15 * 60000 ||
    observed > now + 60000
  )
    return {
      ...base,
      reason: "Предложения конкурентов устарели. Обновите расчёт.",
    };
  if (!rule.enabled) return { ...base, reason: "Правило приостановлено" };
  const competitors = offers.filter(
    (offer) =>
      String(offer.merchant_id) !== String(merchantId) &&
      offer.available !== false &&
      Number.isSafeInteger(offer.price) &&
      offer.price > 0,
  );
  if (!competitors.length)
    return {
      ...base,
      reason: "Доступные предложения других продавцов отсутствуют",
    };
  const competitor = Math.min(...competitors.map((offer) => offer.price));
  const suggested = Math.max(
    floor,
    Math.min(rule.max_price, competitor - rule.step),
  );
  const result = {
    ...base,
    suggested_price: suggested,
    competitor_price: competitor,
  };
  if (suggested === currentPrice)
    return {
      ...result,
      state: "unchanged",
      reason: "Текущая цена соответствует правилу",
    };
  if (
    Math.abs(suggested - currentPrice) * 10000 >
    currentPrice * rule.max_change_bp
  )
    return {
      ...result,
      reason: "Изменение превышает установленный лимит. Проверьте правило.",
    };
  return {
    ...result,
    state: "preview",
    reason:
      suggested >= competitor
        ? "Минимальная допустимая цена ограничивает снижение"
        : "Цена рассчитана по доступным предложениям в выбранном городе",
  };
}
