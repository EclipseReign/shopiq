const { before, after, test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, writeFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const directory = mkdtempSync(path.join(tmpdir(), "shopiq-api-"));
process.env.SHOPIQ_DB_PATH = path.join(directory, "test.sqlite");
process.env.DATABASE_URL = "";
writeFileSync(process.env.SHOPIQ_DB_PATH, "");
const db = require("../models/db");
const { app } = require("../server");
const scraper = require("../services/scraper");
let server;
let base;

before(async () => {
  await db.initialize();
  await scraper.recover();
  await db.query(
    "INSERT INTO categories(id,name,level) VALUES(10000,'Тестовый раздел',0)",
  );
  await db.query(
    "INSERT INTO categories(id,name,parent_id,level) VALUES(10001,'Подраздел',10000,1)",
  );
  const products = [
    [
      10001,
      "Телефон ТЕСТ 100%",
      1000,
      4.9,
      12,
      "2026-01-01 12:00:00",
      "test:1",
    ],
    [
      10001,
      "Другой телефон",
      3000,
      null,
      null,
      "2026-01-02 23:59:59",
      "test:2",
    ],
    [10000, "Без цены", null, null, 0, "2026-01-03 00:00:00", "test:3"],
  ];
  for (const values of products) {
    await db.query(
      "INSERT INTO products(category_id,name,parsed_price,rating,reviews_count,scraped_at,product_key) VALUES($1,$2,$3,$4,$5,$6,$7)",
      values,
    );
  }
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.close();
  rmSync(directory, { recursive: true, force: true });
});

async function get(route, expectedStatus = 200) {
  const response = await fetch(`${base}${route}`);
  assert.equal(response.status, expectedStatus);
  return response.json();
}

test("health and recursive category products", async () => {
  assert.equal((await get("/health")).status, "ok");
  const data = await get("/products?categoryId=10000");
  assert.equal(data.products.length, 3);
});

test("metrics use all filtered products and preserve unknown values", async () => {
  const { overview } = await get("/overview?categoryId=10000");
  assert.equal(overview.products_count, 3);
  assert.equal(overview.average_price, 2000);
  assert.equal(overview.average_rating, 4.9);
  assert.equal(overview.reviews_count, 12);
  assert.equal(overview.reviewed_count, 2);
  assert.equal(overview.priced_count, 2);
  assert.equal(overview.rated_count, 1);
  assert.equal(Object.hasOwn(overview, "revenue"), false);
});

test("pagination and deterministic sorting, missing prices sort last", async () => {
  const first = await get(
    "/products?categoryId=10000&sort=price-asc&pageSize=1",
  );
  const second = await get(
    "/products?categoryId=10000&sort=price-asc&pageSize=1&page=2",
  );
  assert.equal(first.products[0].parsed_price, 1000);
  assert.equal(second.products[0].parsed_price, 3000);
  assert.equal(first.pagination.total, 3);
  assert.equal(first.pagination.pages, 3);
  const descending = await get("/products?categoryId=10000&sort=price-desc");
  assert.equal(descending.products.at(-1).parsed_price, null);
});

test("Russian case-insensitive search and literal wildcard characters", async () => {
  await db.query(
    "UPDATE products SET brand='ОсобыйБренд' WHERE product_key='test:1'",
  );
  assert.equal(
    (await get(`/products?search=${encodeURIComponent("особыйбренд")}`))
      .pagination.total,
    1,
  );
  assert.equal(
    (await get(`/products?search=${encodeURIComponent("тест")}`)).pagination
      .total,
    1,
  );
  assert.equal(
    (await get(`/products?search=${encodeURIComponent("%")}`)).pagination.total,
    1,
  );
  assert.equal(
    (await get(`/products?search=${encodeURIComponent("' OR 1=1 --")}`))
      .pagination.total,
    0,
  );
});

test("date range includes the entire final day", async () => {
  const { products } = await get(
    "/products?categoryId=10000&dateFrom=2026-01-02&dateTo=2026-01-02",
  );
  assert.equal(products.length, 1);
  assert.equal(products[0].parsed_price, 3000);
});

test("bad inputs have actionable 400 responses", async () => {
  for (const query of [
    "categoryId=x",
    "page=-1",
    "pageSize=101",
    "sort=DROP",
    "dateFrom=2026-02-30",
    "dateFrom=2026-02-01&dateTo=2026-01-01",
    "search=a&search=b",
  ]) {
    assert.ok((await get(`/products?${query}`, 400)).error);
  }
  await get("/categories/not-a-number", 400);
  await get("/categories/999999", 404);
});

test("category metrics include descendants exactly once, even with corrupt cycles", async () => {
  const { category } = await get("/categories/10000");
  assert.equal(category.products_count, 3);
  assert.equal(category.reviews_count, 12);
  await db.query("UPDATE categories SET parent_id=10001 WHERE id=10000");
  try {
    assert.equal((await get("/categories/10000")).category.products_count, 3);
  } finally {
    await db.query("UPDATE categories SET parent_id=NULL WHERE id=10000");
  }
});

test("scraper rejects invalid inputs and cross-origin launch", async () => {
  for (const body of [
    { maxPages: 101 },
    { categoryId: [] },
    { workers: [1] },
    { cityId: 0 },
  ]) {
    const response = await fetch(`${base}/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 400);
  }
  const foreign = await fetch(`${base}/scrape`, {
    method: "POST",
    headers: {
      Origin: "https://example.org",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(foreign.status, 403);
});

test("interrupted runs recover and only one run can be active", async () => {
  await db.query(
    "INSERT INTO scraper_runs(id,status,started_at) VALUES('one','running','2026-01-01')",
  );
  await assert.rejects(
    db.query(
      "INSERT INTO scraper_runs(id,status,started_at) VALUES('two','running','2026-01-02')",
    ),
  );
  await scraper.recover();
  assert.equal((await scraper.status()).run.status, "interrupted");
});

test("empty cancellation request succeeds and foreign origins are denied", async () => {
  const response = await fetch(`${base}/scrape/cancel`, { method:'POST' });
  assert.equal(response.status,200);
  assert.ok(Object.hasOwn(await response.json(),'run'));
  assert.equal((await fetch(`${base}/scrape/cancel`,{method:'POST',headers:{Origin:'https://example.org'}})).status,403);
});

test('multi-category membership counts products once and city prices stay separate',async () => {
  const product = (await db.query("SELECT id FROM products WHERE product_key='test:1'")).rows[0];
  await db.query('INSERT INTO product_categories(product_id,category_id) VALUES($1,10000),($1,10001)',[product.id]);
  await db.query("INSERT INTO product_city_prices(product_id,city_id,parsed_price,scraped_at) VALUES($1,'710000000',1700,'2026-02-01 12:00:00')",[product.id]);
  assert.equal((await get('/categories/10000')).category.products_count,3);
  const city = await get('/products?categoryId=10000&cityId=710000000');
  assert.equal(city.pagination.total,1);
  assert.equal(city.products[0].parsed_price,1700);
  assert.equal((await get('/overview?categoryId=10000&cityId=710000000')).overview.average_price,1700);
});
