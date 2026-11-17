const path = require("node:path");
require("dotenv").config({
  path: path.resolve(__dirname, "../.env"),
  quiet: true,
});
require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });
const express = require("express");
const db = require("./models/db");
const scraper = require("./services/scraper");
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));
app.use("/api", require("./routes/api"));
app.use((req, res) => res.status(404).json({ error: "Адрес API не найден" }));
app.use((error, req, res, next) => {
  if (!error.status || error.status >= 500) console.error(error);
  res.status(error.status || 500).json({
    error:
      error.status && error.status < 500
        ? error.message
        : "Ошибка сервера. Проверьте журнал backend.",
  });
});

async function start() {
  await db.initialize();
  await scraper.recover();
  const port = Number(process.env.API_PORT || process.env.PORT || 5000);
  const server = app.listen(port, process.env.HOST || "127.0.0.1", () =>
    console.log(`ShopIQ API http://127.0.0.1:${port}/api`),
  );
  async function shutdown() {
    await scraper.stop();
    server.close(async () => {
      await db.close();
      process.exit(0);
    });
  }
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.on("message", (message) => {
    if (message === "shutdown") shutdown();
  });
  return server;
}
if (require.main === module)
  start().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { app, start };
