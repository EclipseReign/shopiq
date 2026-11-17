const db = require("../models/db");

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function integer(value, name, fallback, max = 2147483647) {
  if (value === undefined || value === "") return fallback;
  if (
    !["string", "number"].includes(typeof value) ||
    !/^[1-9]\d*$/.test(String(value)) ||
    Number(value) > max
  ) {
    throw badRequest(`Некорректное значение ${name}`);
  }
  return Number(value);
}

function date(value, name) {
  if (value === undefined || value === "") return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  ) {
    throw badRequest(`Некорректная дата ${name}`);
  }
  return value;
}

function filters(query) {
  const values = [];
  const conditions = [];
  const categoryId = integer(query.categoryId, "категории", null);
  const dateFrom = date(query.dateFrom, "начала");
  const dateTo = date(query.dateTo, "окончания");
  if (dateFrom && dateTo && dateFrom > dateTo)
    throw badRequest("Дата начала должна предшествовать дате окончания");
  if (categoryId) {
    values.push(categoryId);
    conditions.push(`p.category_id IN (SELECT id FROM selected)`);
  }
  if (query.search !== undefined && typeof query.search !== "string")
    throw badRequest("Некорректный поисковый запрос");
  const search = (query.search || "").trim();
  if (search.length > 200)
    throw badRequest("Поисковый запрос длиннее 200 символов");
  if (search) {
    values.push(`%${search.toLowerCase().replace(/[\\%_]/g, "\\$&")}%`);
    conditions.push(
      `(LOWER(p.name) LIKE $${values.length} ESCAPE '\\' OR LOWER(p.brand) LIKE $${values.length} ESCAPE '\\')`,
    );
  }
  if (dateFrom) {
    values.push(`${dateFrom} 00:00:00`);
    conditions.push(`p.scraped_at >= $${values.length}`);
  }
  if (dateTo) {
    const tomorrow = new Date(`${dateTo}T00:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    values.push(`${tomorrow.toISOString().slice(0, 10)} 00:00:00`);
    conditions.push(`p.scraped_at < $${values.length}`);
  }
  return {
    cte: categoryId
      ? "WITH RECURSIVE selected(id) AS (SELECT id FROM categories WHERE id=$1 UNION SELECT c.id FROM categories c JOIN selected s ON c.parent_id=s.id)"
      : "",
    where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    values,
  };
}

const sorts = {
  default: "p.scraped_at DESC NULLS LAST",
  "price-asc": "p.parsed_price ASC NULLS LAST",
  "price-desc": "p.parsed_price DESC NULLS LAST",
  rating: "p.rating DESC NULLS LAST",
  reviews: "p.reviews_count DESC NULLS LAST",
};

async function getProducts(query) {
  const { cte, where, values } = filters(query);
  const page = integer(query.page, "страницы", 1, 1_000_000);
  const pageSize = integer(query.pageSize, "размера страницы", 25, 100);
  const sort = query.sort || "default";
  if (!Object.hasOwn(sorts, sort))
    throw badRequest("Неизвестный способ сортировки");
  const [count, products] = await Promise.all([
    db.query(
      `${cte} SELECT COUNT(*) AS total FROM products p ${where}`,
      values,
    ),
    db.query(
      `${cte} SELECT p.id,p.category_id,c.name AS category_name,p.name,p.parsed_price,p.rating,
      p.reviews_count,p.image_url,p.product_url,p.scraped_at,p.city_id,p.brand
      FROM products p LEFT JOIN categories c ON c.id=p.category_id ${where}
      ORDER BY ${sorts[sort]},p.id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, pageSize, (page - 1) * pageSize],
    ),
  ]);
  return {
    products: products.rows,
    pagination: {
      page,
      pageSize,
      total: Number(count.rows[0].total),
      pages: Math.ceil(Number(count.rows[0].total) / pageSize),
    },
  };
}

async function getOverview(query) {
  const { cte, where, values } = filters(query);
  const result = await db.query(
    `${cte} SELECT COUNT(*) AS products_count,COUNT(DISTINCT p.category_id) AS categories_count,
    COUNT(p.parsed_price) AS priced_count,AVG(p.parsed_price) AS average_price,
    MIN(p.parsed_price) AS min_price,MAX(p.parsed_price) AS max_price,
    SUM(p.reviews_count) AS reviews_count,COUNT(p.reviews_count) AS reviewed_count,
    AVG(p.rating) AS average_rating,COUNT(p.rating) AS rated_count,
    MAX(p.scraped_at) AS last_updated FROM products p ${where}`,
    values,
  );
  const overview = result.rows[0];
  for (const key of Object.keys(overview)) {
    if (key !== "last_updated" && overview[key] !== null)
      overview[key] = Number(overview[key]);
  }
  return { overview };
}

async function getCategories(parentId) {
  const id = integer(parentId, "родительской категории", null);
  const result = await db.query(
    `WITH RECURSIVE tree(root,id) AS (
      SELECT id,id FROM categories WHERE ${id ? "parent_id=$1" : "parent_id IS NULL"}
      UNION SELECT t.root,c.id FROM categories c JOIN tree t ON c.parent_id=t.id
    ), metrics AS (
      SELECT t.root,COUNT(p.id) AS products_count,AVG(p.parsed_price) AS average_price,
        SUM(p.reviews_count) AS reviews_count,MAX(p.scraped_at) AS last_updated
      FROM tree t JOIN products p ON p.category_id=t.id GROUP BY t.root
    ) SELECT c.id,c.name,c.parent_id,c.level,
      EXISTS(SELECT 1 FROM categories child WHERE child.parent_id=c.id) AS has_children,
      COALESCE(m.products_count,0) AS products_count,m.average_price,m.reviews_count,m.last_updated
    FROM categories c LEFT JOIN metrics m ON m.root=c.id
    WHERE ${id ? "c.parent_id=$1" : "c.parent_id IS NULL"}
    ORDER BY COALESCE(m.products_count,0) DESC,c.name,c.id`,
    id ? [id] : [],
  );
  return {
    categories: result.rows.map((row) => ({
      ...row,
      has_children: Boolean(row.has_children),
      products_count: Number(row.products_count),
      average_price:
        row.average_price == null ? null : Number(row.average_price),
      reviews_count:
        row.reviews_count == null ? null : Number(row.reviews_count),
    })),
  };
}

async function getCategory(id) {
  const categoryId = integer(id, "категории", null);
  const result = await db.query(
    `WITH RECURSIVE selected(id) AS (
      SELECT id FROM categories WHERE id=$1
      UNION SELECT c.id FROM categories c JOIN selected s ON c.parent_id=s.id
    ) SELECT c.id,c.name,c.parent_id,c.level,
      EXISTS(SELECT 1 FROM categories target WHERE target.id IN (SELECT id FROM selected)
        AND target.url IS NOT NULL AND NOT EXISTS(SELECT 1 FROM categories child WHERE child.parent_id=target.id)) AS can_scrape
      FROM categories c WHERE c.id=$1`,
    [categoryId],
  );
  if (!result.rows.length)
    throw Object.assign(new Error("Категория не найдена"), { status: 404 });
  const { overview } = await getOverview({ categoryId: String(categoryId) });
  return {
    category: {
      ...result.rows[0],
      can_scrape: Boolean(result.rows[0].can_scrape),
      ...overview,
    },
  };
}

module.exports = {
  getProducts,
  getOverview,
  getCategories,
  getCategory,
  integer,
  badRequest,
};
