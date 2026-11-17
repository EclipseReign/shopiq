const path = require("node:path");
const { promisify } = require("node:util");
const execFile = promisify(require("node:child_process").execFile);
const root = path.resolve(__dirname, "../..");
let database;
let postgres;

async function initialize() {
  await execFile(
    process.env.PYTHON_BIN || "python",
    [path.join(root, "backend/scraper/storage.py")],
    {
      cwd: root,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      timeout: 120_000,
    },
  );
  postgres = Boolean(process.env.DATABASE_URL);
  if (postgres) {
    const { Pool, types } = require("pg");
    // Scraper timestamps are stored in UTC. Keep naive PG timestamps as text
    // so the host timezone cannot shift dates before the API serializes them.
    types.setTypeParser(1114, (value) => value);
    const maxConnections = Number(process.env.PG_POOL_MAX || 5);
    if (!Number.isSafeInteger(maxConnections) || maxConnections < 1)
      throw new Error("PG_POOL_MAX должен быть положительным целым числом");
    database = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: maxConnections,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 15_000,
    });
    database.on("error", (error) =>
      console.error("Database connection error", error.message),
    );
  } else {
    const { DatabaseSync } = require("node:sqlite");
    database = new DatabaseSync(
      path.resolve(
        root,
        process.env.SHOPIQ_DB_PATH || "backend/data/shopiq.sqlite",
      ),
    );
    database.function("lower", { deterministic: true }, (value) =>
      value == null ? null : String(value).toLowerCase(),
    );
    database.exec(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;",
    );
  }
}

async function query(sql, values = []) {
  if (postgres) return database.query(sql, values);
  // Reorder repeated PostgreSQL parameters for SQLite's positional bindings.
  const bindings = [];
  const sqliteSql = sql.replace(/\$(\d+)/g, (_, index) => {
    bindings.push(values[Number(index) - 1]);
    return "?";
  });
  const statement = database.prepare(sqliteSql);
  if (statement.columns().length) return { rows: statement.all(...bindings) };
  return { rows: [], rowCount: Number(statement.run(...bindings).changes) };
}

async function close() {
  if (!database) return;
  if (postgres) await database.end();
  else database.close();
  database = null;
}

module.exports = { initialize, query, close };
