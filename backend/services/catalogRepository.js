const { randomUUID, createHash } = require("node:crypto");
const db = require("../models/db");

const timestamp = () =>
  new Date()
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, "");

async function insertRows(connection, table, columns, rows, suffix = "") {
  const returned = [];
  for (let offset = 0; offset < rows.length; offset += 300) {
    const chunk = rows.slice(offset, offset + 300);
    const values = chunk.flat();
    let index = 0;
    const placeholders = chunk
      .map((row) => `(${row.map(() => `$${++index}`).join(",")})`)
      .join(",");
    const result = await connection.query(
      `INSERT INTO ${table}(${columns.join(",")}) VALUES${placeholders} ${suffix}`,
      values,
    );
    returned.push(...result.rows);
  }
  return returned;
}

async function saveNavigation(nodes, cityId) {
  const id = randomUUID();
  const now = timestamp();
  await db.query(
    "INSERT INTO catalog_discoveries(id,city_id,status,started_at) VALUES($1,$2,'running',$3)",
    [id, cityId, now],
  );
  try {
    return await db.transaction(async (connection) => {
      const existing = (
        await connection.query(
          "SELECT id,url,source_code FROM categories ORDER BY id",
        )
      ).rows;
      const byCode = new Map(
        existing
          .filter((row) => row.source_code)
          .map((row) => [row.source_code, Number(row.id)]),
      );
      const byUrl = new Map();
      for (const row of existing) {
        if (row.source_code || !row.url) continue;
        const url = row.url.startsWith("https://")
          ? row.url
          : `https://kaspi.kz${row.url}`;
        if (!byUrl.has(url)) byUrl.set(url, Number(row.id));
      }
      let nextId = Math.max(0, ...existing.map((row) => Number(row.id)));
      let reserved = [];
      let reservedIndex = 0;
      if (process.env.DATABASE_URL) {
        const missing = nodes.filter((node) => !byCode.has(node.code)).length;
        if (missing)
          reserved = (
            await connection.query(
              "SELECT nextval(pg_get_serial_sequence('categories','id')) AS id FROM generate_series(1,$1)",
              [missing],
            )
          ).rows.map((row) => Number(row.id));
      }
      const rows = [];
      for (const node of nodes) {
        const categoryId =
          byCode.get(node.code) ||
          byUrl.get(node.url) ||
          reserved[reservedIndex++] ||
          ++nextId;
        byUrl.delete(node.url);
        byCode.set(node.code, categoryId);
        const parentId = node.parent_code ? byCode.get(node.parent_code) : null;
        if (node.parent_code && !parentId)
          throw new Error("Родитель категории отсутствует в снимке источника");
        rows.push([
          categoryId,
          node.name,
          node.url,
          parentId,
          node.level,
          node.code,
          1,
          now,
        ]);
      }
      await connection.query(
        "UPDATE categories SET source_active=0 WHERE source_code IS NOT NULL",
      );
      await insertRows(
        connection,
        "categories",
        [
          "id",
          "name",
          "url",
          "parent_id",
          "level",
          "source_code",
          "source_active",
          "discovered_at",
        ],
        rows,
        "ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url,parent_id=excluded.parent_id,level=excluded.level,source_code=excluded.source_code,source_active=excluded.source_active,discovered_at=excluded.discovered_at",
      );
      const leaves = nodes.filter((node) => node.is_leaf).length;
      await connection.query(
        "UPDATE catalog_discoveries SET status='completed',finished_at=$1,categories_count=$2,leaves_count=$3 WHERE id=$4",
        [timestamp(), nodes.length, leaves, id],
      );
      return { id, categories: nodes.length, leaves };
    });
  } catch (error) {
    await db.query(
      "UPDATE catalog_discoveries SET status='failed',finished_at=$1,error=$2 WHERE id=$3",
      [timestamp(), error.message, id],
    );
    throw error;
  }
}

async function prepareTasks(runId, cityId, categoryId) {
  const cte = categoryId
    ? `WITH RECURSIVE selected(id) AS (SELECT id FROM categories WHERE id=$1 UNION SELECT c.id FROM categories c JOIN selected s ON c.parent_id=s.id)`
    : "";
  const categories = (
    await db.query(
      `${cte} SELECT c.id,c.name,c.url,c.source_code FROM categories c
    WHERE c.source_active=1 ${categoryId ? "AND c.id IN (SELECT id FROM selected)" : ""}
      AND NOT EXISTS(SELECT 1 FROM categories child WHERE child.parent_id=c.id AND child.source_active=1)
    ORDER BY c.id`,
      categoryId ? [categoryId] : [],
    )
  ).rows;
  if (!categories.length)
    throw new Error(
      "В выбранном разделе отсутствуют актуальные конечные категории. Обновите дерево Kaspi",
    );
  await db.transaction((connection) =>
    insertRows(
      connection,
      "catalog_tasks",
      ["run_id", "category_id", "city_id", "status", "updated_at"],
      categories.map((category) => [
        runId,
        category.id,
        cityId,
        "pending",
        timestamp(),
      ]),
      "ON CONFLICT(run_id,category_id) DO NOTHING",
    ),
  );
  return categories;
}

async function savePage({
  runId,
  categoryId,
  cityId,
  page,
  products,
  total,
  pageSize,
  hasMore,
  invalidCount = 0,
  limited = false,
}) {
  products = [
    ...new Map(
      products.map((product) => [product.external_id, product]),
    ).values(),
  ];
  const observedAt = timestamp();
  const signature = createHash("sha256")
    .update(
      products
        .map((product) => product.external_id)
        .sort()
        .join("|"),
    )
    .digest("hex");
  return db.transaction(async (connection) => {
    const prior = (
      await connection.query(
        "SELECT signature FROM catalog_pages WHERE run_id=$1 AND category_id=$2 AND page=$3",
        [runId, categoryId, page],
      )
    ).rows[0];
    if (prior) return { duplicate: true, saved: 0, added: 0 };
    const task = (
      await connection.query(
        "SELECT * FROM catalog_tasks WHERE run_id=$1 AND category_id=$2",
        [runId, categoryId],
      )
    ).rows[0];
    if (!task || Number(task.next_page) !== page)
      throw new Error("Страница не соответствует сохранённой позиции сбора");
    await connection.query(
      "INSERT INTO catalog_pages(run_id,category_id,page,signature) VALUES($1,$2,$3,$4)",
      [runId, categoryId, page, signature],
    );
    const keys = products.map((product) => product.product_key);
    const legacyKeys = products.map(
      (product) =>
        "legacy:" +
        createHash("sha256")
          .update(
            `${categoryId}|${product.name.toLowerCase().trim().replace(/\s+/g, " ")}`,
          )
          .digest("hex"),
    );
    const lookup = [...keys, ...legacyKeys];
    const existing = lookup.length
      ? (
          await connection.query(
            `SELECT id,product_key FROM products WHERE product_key IN (${lookup.map((_, index) => `$${index + 1}`).join(",")})`,
            lookup,
          )
        ).rows
      : [];
    const known = new Set(existing.map((row) => row.product_key));
    for (let index = 0; index < products.length; index++) {
      if (!known.has(keys[index]) && known.has(legacyKeys[index]))
        await connection.query(
          "UPDATE products SET product_key=$1 WHERE product_key=$2",
          [keys[index], legacyKeys[index]],
        );
    }
    const columns = [
      "category_id",
      "name",
      "price",
      "parsed_price",
      "brand",
      "rating",
      "reviews_count",
      "image_url",
      "external_id",
      "product_url",
      "product_key",
      "city_id",
      "scraped_at",
    ];
    const productRows = products.map((product) =>
      columns.map((column) =>
        column === "scraped_at" ? observedAt : (product[column] ?? null),
      ),
    );
    const updates = columns
      .filter((column) => column !== "product_key" && column !== "category_id")
      .map((column) => `${column}=excluded.${column}`)
      .join(",");
    const saved = await insertRows(
      connection,
      "products",
      columns,
      productRows,
      `ON CONFLICT(product_key) DO UPDATE SET ${updates},category_id=COALESCE(products.category_id,excluded.category_id) RETURNING id,product_key`,
    );
    if (saved.length) {
      await insertRows(
        connection,
        "product_categories",
        ["product_id", "category_id"],
        saved.map((product) => [product.id, categoryId]),
        "ON CONFLICT(product_id,category_id) DO NOTHING",
      );
      const priceByKey = new Map(
        products.map((product) => [product.product_key, product.parsed_price]),
      );
      const ids = saved.map((product) => Number(product.id));
      const previousPrices = (
        await connection.query(
          `SELECT product_id,parsed_price FROM product_city_prices WHERE city_id=$1 AND product_id IN (${ids.map((_, index) => `$${index + 2}`).join(",")})`,
          [cityId, ...ids],
        )
      ).rows;
      const previous = new Map(
        previousPrices.map((row) => [
          Number(row.product_id),
          row.parsed_price === null ? null : Number(row.parsed_price),
        ]),
      );
      const changed = saved.filter(
        (product) =>
          priceByKey.get(product.product_key) !== null &&
          previous.get(Number(product.id)) !==
            priceByKey.get(product.product_key),
      );
      await insertRows(
        connection,
        "price_history",
        ["product_id", "city_id", "parsed_price", "scraped_at"],
        changed.map((product) => [
          product.id,
          cityId,
          priceByKey.get(product.product_key),
          observedAt,
        ]),
      );
      await insertRows(
        connection,
        "product_city_prices",
        ["product_id", "city_id", "parsed_price", "scraped_at"],
        saved.map((product) => [
          product.id,
          cityId,
          priceByKey.get(product.product_key),
          observedAt,
        ]),
        "ON CONFLICT(product_id,city_id) DO UPDATE SET parsed_price=excluded.parsed_price,scraped_at=excluded.scraped_at",
      );
    }
    const added = await insertRows(
      connection,
      "catalog_seen",
      ["run_id", "category_id", "product_id"],
      saved.map((product) => [runId, categoryId, product.id]),
      "ON CONFLICT(run_id,category_id,product_id) DO NOTHING RETURNING product_id",
    );
    const found = Number(task.found_count) + added.length;
    const invalid = Number(task.invalid_count) + invalidCount;
    const expectedInitial =
      task.expected_initial == null ? total : Number(task.expected_initial);
    let state = "running";
    if (limited && hasMore) state = "limited";
    else if (!hasMore)
      state =
        invalid ||
        found < Math.max(expectedInitial, total) ||
        expectedInitial !== total
          ? "partial"
          : "completed";
    await connection.query(
      `UPDATE catalog_tasks SET status=$1,next_page=$2,expected_initial=$3,expected_latest=$4,page_size=$5,
      found_count=$6,invalid_count=$7,pages_done=pages_done+1,error=NULL,updated_at=$8 WHERE run_id=$9 AND category_id=$10`,
      [
        state,
        page + 1,
        expectedInitial,
        total,
        pageSize,
        found,
        invalid,
        observedAt,
        runId,
        categoryId,
      ],
    );
    return {
      duplicate: false,
      saved: products.length,
      added: added.length,
      found,
      status: state,
    };
  });
}

async function taskFailed(runId, categoryId, error) {
  await db.query(
    "UPDATE catalog_tasks SET status='failed',error=$1,updated_at=$2 WHERE run_id=$3 AND category_id=$4",
    [String(error).slice(0, 2000), timestamp(), runId, categoryId],
  );
}

async function coverage(runId) {
  const discovery =
    (
      await db.query(
        "SELECT * FROM catalog_discoveries WHERE status='completed' ORDER BY finished_at DESC LIMIT 1",
      )
    ).rows[0] || null;
  if (!runId) {
    const latest = (
      await db.query(
        "SELECT t.run_id FROM catalog_tasks t JOIN scraper_runs r ON r.id=t.run_id ORDER BY r.started_at DESC,t.run_id LIMIT 1",
      )
    ).rows[0];
    runId = latest?.run_id;
  }
  const tasks = runId
    ? (
        await db.query(
          `SELECT t.*,c.name,c.source_code FROM catalog_tasks t JOIN categories c ON c.id=t.category_id WHERE t.run_id=$1 ORDER BY CASE WHEN t.status IN ('failed','partial') THEN 0 ELSE 1 END,c.name`,
          [runId],
        )
      ).rows
    : [];
  const summary = {
    total: tasks.length,
    completed: 0,
    failed: 0,
    partial: 0,
    limited: 0,
    pending: 0,
    running: 0,
    pages: 0,
    found: 0,
    expected: 0,
    unknown: 0,
  };
  for (const task of tasks) {
    summary[task.status] = (summary[task.status] || 0) + 1;
    summary.pages += Number(task.pages_done);
    summary.found += Number(task.found_count);
    if (task.expected_latest == null) summary.unknown++;
    else summary.expected += Number(task.expected_latest);
  }
  const run = runId
    ? (
        await db.query(
          "SELECT options,status,started_at,finished_at FROM scraper_runs WHERE id=$1",
          [runId],
        )
      ).rows[0]
    : null;
  const options = JSON.parse(run?.options || "{}");
  const complete = tasks.length > 0 && summary.completed === tasks.length;
  return {
    discovery,
    runId: runId || null,
    summary,
    complete,
    fullCatalogComplete:
      complete &&
      !options.categoryId &&
      tasks.length === Number(discovery?.leaves_count),
    scope: {
      categoryId: options.categoryId || null,
      cityId: options.cityId || null,
      full: Boolean(options.full),
    },
    tasks,
  };
}

module.exports = {
  saveNavigation,
  prepareTasks,
  savePage,
  taskFailed,
  coverage,
};
