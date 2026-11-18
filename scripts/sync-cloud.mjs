import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const { values } = parseArgs({
  options: {
    database: { type: "string", default: "backend/data/shopiq.sqlite" },
    "env-file": { type: "string", default: ".env.cloud" },
  },
});
dotenv.config({ path: values["env-file"], quiet: true });
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key)
  throw new Error(
    "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the selected env file",
  );
const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const local = new DatabaseSync(resolve(values.database), { readOnly: true });
const definitions = {
  categories: [
    "id",
    "name",
    "url",
    "parent_id",
    "level",
    "source_code",
    "source_active",
    "discovered_at",
  ],
  products: [
    "id",
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
  ],
  product_categories: ["product_id", "category_id"],
  product_city_prices: ["product_id", "city_id", "parsed_price", "scraped_at"],
  price_history: ["id", "product_id", "city_id", "parsed_price", "scraped_at"],
  catalog_discoveries: [
    "id",
    "city_id",
    "status",
    "started_at",
    "finished_at",
    "categories_count",
    "leaves_count",
    "error",
  ],
};
const conflict = {
  categories: "id",
  products: "product_key",
  product_categories: "product_id,category_id",
  product_city_prices: "product_id,city_id",
  price_history: "id",
  catalog_discoveries: "id",
};
function timestamps(row) {
  for (const key of [
    "scraped_at",
    "discovered_at",
    "started_at",
    "finished_at",
    "updated_at",
  ]) {
    if (typeof row[key] === "string" && !/(?:Z|[+-]\d{2}:\d{2})$/i.test(row[key]))
      row[key] = row[key].replace(" ", "T") + "Z";
  }
  return row;
}
async function write(table, batch, onConflict) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const result = await client.from(table).upsert(batch, { onConflict });
    if (!result.error) return;
    if (
      attempt === 3 ||
      (!["57014", "53300", "PGRST000", "PGRST001"].includes(
        result.error.code,
      ) &&
        !/fetch|network|timeout/i.test(result.error.message))
    )
      throw new Error(
        `Import ${table} failed (${result.error.code || "network"})`,
      );
    await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
  }
}
try {
  // Existing product keys must keep their cloud IDs so memberships remain valid.
  const existingIds = new Map();
  const existingKeys = new Map();
  for (let offset=0;;offset+=1000) {
    const existing=await client.from('products').select('id,product_key').order('id').range(offset,offset+999);
    if (existing.error) throw new Error(`Cloud schema unavailable (${existing.error.code})`);
    for (const row of existing.data) {
      existingIds.set(row.product_key,Number(row.id));
      existingKeys.set(Number(row.id),row.product_key);
    }
    if (existing.data.length<1000) break;
  }
  for (const [table, columns] of Object.entries(definitions)) {
    const order =
      table === "categories"
        ? "level,id"
        : table === "products"
          ? "id"
          : columns.join(",");
    let count = 0;
    for (let offset = 0; ; offset += 300) {
      const batch = local
        .prepare(
          `SELECT ${columns.join(",")} FROM ${table} ORDER BY ${order} LIMIT 300 OFFSET ?`,
        )
        .all(offset)
        .map(timestamps);
      if (!batch.length) break;
      // Sync operates on a local catalog's preserved numeric IDs. Refuse divergent
      // databases instead of silently reassigning cloud product relationships.
      if (table === "products") {
        if (
          batch.some(
            (row) =>
              (existingIds.has(row.product_key) && existingIds.get(row.product_key)!==Number(row.id)) ||
              (existingKeys.has(Number(row.id)) && existingKeys.get(Number(row.id))!==row.product_key),
          )
        )
          throw new Error(
            "Local and cloud product IDs diverged. Use an explicit reconciliation before syncing.",
          );
      }
      await write(table, batch, conflict[table]);
      count += batch.length;
    }
    console.log(JSON.stringify({ table, rows: count }));
  }
  const sequences = await client.rpc("sync_identity_sequences");
  if (sequences.error) throw new Error("Identity sequences were not updated");
} finally {
  local.close();
}
