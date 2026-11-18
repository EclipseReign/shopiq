const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
let db, feed, pricing, kaspi;
const owner = "11111111-1111-4111-8111-111111111111";
const stranger = "22222222-2222-4222-8222-222222222222";
const store = "33333333-3333-4333-8333-333333333333";
const ruleId = "44444444-4444-4444-8444-444444444444";
const xml = `<?xml version="1.0" encoding="utf-8"?><kaspi_catalog xmlns="kaspiShopping"><company>Test</company><merchantid>seller</merchantid><offers><offer sku="A"><model>Phone &amp; Case</model><availabilities><availability available="yes" storeId="warehouse1" preOrder="3" stockCount="234"/></availabilities><price>10000</price></offer><offer sku="B"><model>Other</model><cityprices><cityprice cityId="750000000">20000</cityprice><cityprice cityId="710000000">21000</cityprice></cityprices></offer></offers></kaspi_catalog>`;
const rule = {
  sku: "A",
  external_id: "123",
  city_id: "*",
  min_price: 8000,
  max_price: 12000,
  cost: 5000,
  shipping: 0,
  commission_bp: 1000,
  tax_bp: 0,
  margin_bp: 2000,
  step: 1,
  max_change_bp: 2000,
  auto_enabled: false,
  enabled: true,
};

before(async () => {
  [feed, pricing, kaspi] = await Promise.all([
    import("../../shared/feed.mjs"),
    import("../../shared/pricing.mjs"),
    import("../../shared/kaspi.mjs"),
  ]);
  const { PGlite } = await import("@electric-sql/pglite");
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
    create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to public;`);
  await db.exec(
    await readFile(
      path.join(
        __dirname,
        "../../supabase/migrations/20261118075421_shopiq_platform.sql",
      ),
      "utf8",
    ),
  );
  await db.query("insert into auth.users(id) values($1),($2)", [
    owner,
    stranger,
  ]);
  await db.query(
    "insert into public.stores(id,owner_id,name,merchant_id,city_id) values($1,$2,'Mine','seller','750000000')",
    [store, owner],
  );
  await db.query(
    "insert into public.stores(owner_id,name,merchant_id,city_id) values($1,'Other','other','710000000')",
    [stranger],
  );
});
after(async () => {
  await db?.close();
});

test('seller pagination follows the actual source page size',async()=>{
  const requests=[];
  const fetcher=async(_url,init)=>{
    const body=JSON.parse(init.body);requests.push(body);
    const offers=body.page===0?[{merchantId:'one',price:100},{merchantId:'two',price:200}]:[{merchantId:'three',price:300}];
    return Response.json({offers,total:3});
  };
  const first=await kaspi.fetchOffers('123','750000000',{fetcher});
  assert.equal(first.pageSize,2);assert.equal(first.hasMore,true);
  const second=await kaspi.fetchOffers('123','750000000',{fetcher,page:1,pageSize:first.pageSize});
  assert.equal(second.hasMore,false);assert.equal(requests[1].limit,2);assert.equal(second.offers[0].merchant_id,'three');
});

test("full XML preserves unmanaged SKUs, warehouse data and other city prices", () => {
  const parsed = feed.parseFeed(xml, "seller");
  assert.equal(parsed.offers.length, 2);
  const output = feed.renderFeed(
    xml,
    "seller",
    { A: { "*": 9999 }, B: { 750000000: 19000 } },
    "2026-11-18T00:00:00Z",
  );
  const result = feed.parseFeed(output, "seller");
  assert.equal(result.offers[0].prices["*"], 9999);
  assert.equal(result.offers[1].prices["710000000"], 21000);
  assert.match(output, /stockCount="234"/);
  assert.match(output, /preOrder="3"/);
  assert.equal(result.offers[0].model, "Phone & Case");
  assert.throws(() => feed.parseFeed(xml, "another"));
  assert.throws(() =>
    feed.parseFeed(
      xml.replace(
        "<offers>",
        '<offers><offer sku="A"><model>duplicate</model><price>1</price></offer>',
      ),
      "seller",
    ),
  );
  assert.throws(() =>
    feed.parseFeed(
      '<!DOCTYPE x [<!ENTITY y SYSTEM "file:///secret">]>' + xml,
      "seller",
    ),
  );
  assert.throws(() => feed.parseFeed(xml.replace("</offer>", ""), "seller"));
});

test("repricing respects floor, margin, own merchant, freshness and change limit", () => {
  const now = Date.now();
  assert.equal(pricing.priceFloor(rule), 8000);
  const input = {
    rule,
    currentPrice: 10000,
    merchantId: "seller",
    observedAt: new Date(now).toISOString(),
    now,
    offers: [
      { merchant_id: "seller", price: 100 },
      { merchant_id: "rival", price: 9500 },
    ],
  };
  assert.equal(pricing.proposePrice(input).suggested_price, 9499);
  assert.equal(pricing.proposePrice(input).state, "preview");
  assert.equal(
    pricing.proposePrice({
      ...input,
      rule: {
        ...rule,
        min_price: "8000",
        max_price: "12000",
        cost: "5000",
        shipping: "0",
        step: "1",
      },
      currentPrice: "10000",
    }).state,
    "preview",
  );
  assert.equal(
    pricing.proposePrice({
      ...input,
      offers: [{ merchant_id: "rival", price: 1000 }],
    }).suggested_price,
    8000,
  );
  assert.equal(
    pricing.proposePrice({ ...input, rule: { ...rule, max_change_bp: 100 } })
      .state,
    "blocked",
  );
  assert.equal(
    pricing.proposePrice({
      ...input,
      observedAt: new Date(now - 16 * 60000).toISOString(),
    }).state,
    "blocked",
  );
  assert.equal(
    pricing.proposePrice({
      ...input,
      offers: [{ merchant_id: "seller", price: 9500 }],
    }).state,
    "blocked",
  );
  assert.throws(() => pricing.validateRule({ ...rule, margin_bp: 9000 }));
  assert.equal(
    pricing.priceFloor({ ...rule, min_price: 1, cost: 10001, shipping: 0 }),
    14288,
  );
});

test("Kaspi pagination uses results and rechecks the declared end", async () => {
  const requests = [];
  const fetcher = async (url) => {
    requests.push(new URL(url));
    if (url.pathname.endsWith("/filters"))
      return Response.json({
        redirect: "/c/phones/",
        data: {
          cards: [{ id: "1" }],
          total: 3,
          limit: 1,
          invisibleFilters: ":availableInZones:zone",
          filterCategory: ":category:Phones",
        },
      });
    return Response.json({
      data: [{ id: String(Number(url.searchParams.get("page")) + 1) }],
    });
  };
  let pageInfo;
  const ids = [];
  for (let page = 0; page < 3; page++) {
    const result = await kaspi.fetchCategoryPage("Phones", "750000000", page, {
      fetcher,
      pageInfo,
    });
    pageInfo = result.pageInfo;
    ids.push(result.cards[0].id);
  }
  assert.deepEqual(ids, ["1", "2", "3"]);
  assert.equal(
    requests.filter((url) => url.pathname.endsWith("/filters")).length,
    2,
  );
  assert.deepEqual(
    requests
      .filter((url) => url.pathname.endsWith("/results"))
      .map((url) => url.searchParams.get("page")),
    ["1", "2"],
  );
  assert.equal(
    requests[1].searchParams.get("q"),
    ":availableInZones:zone:category:Phones",
  );
});

test("source category aliases stay distinct and unknown prices are retained", () => {
  const nodes = kaspi.normalizeNavigation({
    subNodes: [
      { code: "one", titleRu: "Один", link: "c/same/", subNodes: [] },
      { code: "two", titleRu: "Два", link: "c/same/", subNodes: [] },
    ],
  });
  assert.equal(nodes.length, 2);
  const product = kaspi.normalizeProduct(
    {
      id: "123",
      title: "Title",
      shopLink: "/p/title-123/",
      reviewsQuantity: 0,
    },
    1,
    "750000000",
  );
  assert.equal(product.parsed_price, null);
  assert.equal(product.reviews_count, 0);
});

test("merchant RLS prevents cross-owner reads, reassignment and direct privileged RPCs", async () => {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner,
  ]);
  try {
    assert.equal(
      (await db.query("select * from public.stores")).rows.length,
      1,
    );
    await assert.rejects(
      db.query("update public.stores set owner_id=$1 where id=$2", [
        stranger,
        store,
      ]),
    );
    await assert.rejects(
      db.query("select public.rotate_feed_token($1,$2,'fake')", [store, owner]),
    );
    await assert.rejects(db.query("select public.catalog_products('{}')"));
  } finally {
    await db.exec("reset role");
  }
});

test("feed import is versioned and removal requires an exact SKU confirmation", async () => {
  const items = feed.parseFeed(xml, "seller").offers;
  const first = (
    await db.query("select public.import_store_feed($1,$2,$3,$4,$5,0) result", [
      store,
      owner,
      xml,
      "hash1",
      JSON.stringify(items),
    ])
  ).rows[0].result;
  assert.equal(first.version, 1);
  await assert.rejects(
    db.query("select public.import_store_feed($1,$2,$3,$4,$5,null)", [
      store,
      owner,
      xml,
      "hash2",
      JSON.stringify(items),
    ]),
  );
  await assert.rejects(
    db.query("select public.import_store_feed($1,$2,$3,$4,$5,1)", [
      store,
      owner,
      xml,
      "hash3",
      JSON.stringify(items.slice(0, 1)),
    ]),
  );
  await db.query("select public.import_store_feed($1,$2,$3,$4,$5,1,$6)", [
    store,
    owner,
    xml,
    "hash4",
    JSON.stringify(items),
    [],
  ]);
  assert.equal(
    (
      await db.query(
        "select version from public.store_feeds where store_id=$1",
        [store],
      )
    ).rows[0].version,
    2,
  );
});

test("price publication is idempotent and simultaneous stale proposals cannot overwrite a new price", async () => {
  const columns = Object.keys(rule);
  await db.query(
    `insert into public.price_rules(id,store_id,${columns.join(",")}) values($1,$2,${columns.map((_, i) => "$" + (i + 3)).join(",")})`,
    [ruleId, store, ...Object.values(rule)],
  );
  const proposal = async (target) => {
    return (
      await db.query(
        `insert into public.price_changes(store_id,rule_id,sku,city_id,feed_version,rule_updated_at,current_price,suggested_price,state,details,observed_at,expires_at)
      select $1,$2,'A','*',2,updated_at,10000,$3,'preview','{}',now(),now()+interval '15 minutes' from public.price_rules where id=$2 returning id`,
        [store, ruleId, target],
      )
    ).rows[0].id;
  };
  const first = await proposal(9499);
  const stale = await proposal(9400);
  assert.equal(
    (
      await db.query("select public.publish_price_change($1,$2,false) result", [
        first,
        owner,
      ])
    ).rows[0].result.state,
    "published",
  );
  assert.equal(
    (
      await db.query("select public.publish_price_change($1,$2,false) result", [
        first,
        owner,
      ])
    ).rows[0].result.state,
    "published",
  );
  await assert.rejects(
    db.query("select public.publish_price_change($1,$2,false)", [stale, owner]),
  );
  assert.equal(
    (
      await db.query(
        "select overrides from public.store_feeds where store_id=$1",
        [store],
      )
    ).rows[0].overrides.A["*"],
    9499,
  );
});

test("collection page retries are atomic, category overlaps are deduplicated and loops roll back", async () => {
  await db.exec(
    "insert into public.categories(id,name,source_code,source_active) values(1,'Test','test',1)",
  );
  const run = (
    await db.query(
      'select public.create_collection($1,\'{"cityId":"750000000","full":true}\',array[1::bigint]) id',
      [owner],
    )
  ).rows[0].id;
  const product = kaspi.normalizeProduct(
    {
      id: "123",
      title: "Phone",
      unitPrice: 10000,
      shopLink: "/p/phone-123/",
      reviewsQuantity: 5,
    },
    1,
    "750000000",
  );
  const input = {
    runId: run,
    categoryId: 1,
    cityId: "750000000",
    page: 0,
    products: [product],
    signature: "page-one",
    total: 2,
    pageSize: 1,
    hasMore: true,
    invalidCount: 0,
    limited: false,
  };
  const commit = async (data) =>
    (
      await db.query("select public.commit_collection_page($1) result", [
        JSON.stringify(data),
      ])
    ).rows[0].result;
  assert.equal((await commit(input)).saved, 1);
  assert.equal((await commit(input)).duplicate, true);
  await assert.rejects(commit({ ...input, page: 1 }));
  assert.equal(
    (
      await db.query(
        "select next_page from public.collection_tasks where run_id=$1",
        [run],
      )
    ).rows[0].next_page,
    1,
  );
  const last = {
    ...input,
    page: 1,
    products: [{ ...product, external_id: "124", product_key: "kaspi:124" }],
    signature: "page-two",
    hasMore: false,
  };
  assert.equal((await commit(last)).status, "completed");
  assert.equal(
    (await db.query("select public.collection_progress($1) result", [run]))
      .rows[0].result.completed,
    1,
  );
  assert.equal(
    (
      await db.query(
        "select public.catalog_products('{\"categoryId\":1}') result",
      )
    ).rows[0].result.pagination.total,
    2,
  );
  assert.equal(
    (await db.query("select public.catalog_categories(null) result")).rows[0]
      .result.categories[0].products_count,
    2,
  );
});
