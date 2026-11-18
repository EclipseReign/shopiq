const { spawn, execFile } = require("node:child_process");
const { randomUUID, timingSafeEqual } = require("node:crypto");
const { mkdir, writeFile, unlink } = require("node:fs/promises");
const path = require("node:path");
const { hostname } = require('node:os');
const db = require("../models/db");
const { integer, badRequest } = require("./catalog");
const root = path.resolve(__dirname, "../..");
let active;

function localAddress(address) {
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address);
}

function authorize(req, res, next) {
  const origin = req.headers.origin;
  const localOrigin =
    !origin ||
    /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(origin);
  if (localAddress(req.socket.remoteAddress) && localOrigin) return next();
  const supplied = (req.headers.authorization || "").replace(/^Bearer /, "");
  const expected = process.env.SCRAPER_TOKEN;
  if (
    expected &&
    Buffer.byteLength(supplied) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  )
    return next();
  res.status(403).json({
    error: "Для удалённого управления сбором требуется SCRAPER_TOKEN",
  });
}

async function recover() {
  const runs = (await db.query("SELECT * FROM scraper_runs WHERE status IN ('running','cancelling')")).rows;
  for (const run of runs) {
    if (run.id === active?.id || standaloneAlive(run)) continue;
    await db.query("UPDATE scraper_runs SET status='interrupted',finished_at=$1,error=$2 WHERE id=$3 AND status IN ('running','cancelling')",
      [new Date().toISOString(),'Исполнитель остановлен. Сохранённые страницы доступны для проверки.',run.id]);
  }
  await db.query(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_one_scraper_run ON scraper_runs((1)) WHERE status IN ('running','cancelling')",
  );
}

function standaloneAlive(run) {
  const options = JSON.parse(run.options || '{}');
  const progress = JSON.parse(run.progress || '{}');
  if (options.ownerMode !== 'standalone' || options.ownerHost !== hostname() ||
      !Number.isInteger(options.ownerPid) || options.ownerPid < 1 ||
      !progress.heartbeat || Date.now() - Date.parse(progress.heartbeat) > 180000) return false;
  try { process.kill(options.ownerPid,0); return true; }
  catch { return false; }
}

async function status() {
  await recover();
  const result = await db.query(
    "SELECT * FROM scraper_runs ORDER BY started_at DESC LIMIT 1",
  );
  const row = result.rows[0];
  return {
    run: row
      ? {
          ...row,
          options: JSON.parse(row.options || "{}"),
          progress: JSON.parse(row.progress || "{}"),
        }
      : null,
  };
}

async function start(body = {}) {
  if (!body || Array.isArray(body) || typeof body !== "object")
    throw badRequest("Некорректные параметры сбора");
  if (active)
    throw Object.assign(new Error("Сбор уже выполняется"), { status: 409 });
  const categoryId = integer(body.categoryId, "категории", null);
  const maxPages = integer(body.maxPages, "лимита страниц", 3, 100);
  const workers = integer(body.workers, "числа браузеров", 1, 4);
  for (const key of ['full','discover']) {
    if (body[key] !== undefined && typeof body[key] !== 'boolean') throw badRequest('Некорректный режим сбора');
  }
  const cityId = String(body.cityId ?? "750000000");
  if (!/^\d{9}$/.test(cityId))
    throw badRequest("ID города должен состоять из 9 цифр");
  if (categoryId) {
    const result = await db.query("SELECT id FROM categories WHERE id=$1", [
      categoryId,
    ]);
    if (!result.rows.length) throw badRequest("Категория не найдена");
  }
  const id = randomUUID();
  const startedAt = new Date().toISOString();
  const options = { categoryId, maxPages, workers, cityId, full: Boolean(body.full), discover: Boolean(body.discover), engine: 'http' };
  const cancelFile = path.join(root, "backend/data", `${id}.cancel`);
  await mkdir(path.dirname(cancelFile), { recursive: true });
  try {
    await db.query(
      "INSERT INTO scraper_runs(id,status,started_at,options,progress) VALUES($1,'running',$2,$3,$4)",
      [
        id,
        startedAt,
        JSON.stringify(options),
        JSON.stringify({
          saved: 0,
          pages: 0,
          completedCategories: 0,
          events: [],
        }),
      ],
    );
  } catch (error) {
    if (String(error.code).includes("CONSTRAINT") || error.code === "23505") {
      throw Object.assign(new Error("Сбор уже выполняется"), { status: 409 });
    }
    throw error;
  }
  const args = [
    path.join(root, "backend/scraper/http-scraper.mjs"),
    '--run-id',id,
    "--max-pages",
    String(maxPages),
    "--workers",
    String(workers),
    "--city-id",
    cityId,
    "--cancel-file",
    cancelFile,
  ];
  if (categoryId) args.push("--category-id", String(categoryId));
  if (options.full) args.push('--full');
  if (options.discover) args.push('--discover');
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const job = {
    child,
    id,
    cancelFile,
    cancelling: false,
    error: null,
    progress: { saved: 0, pages: 0, completedCategories: 0, events: [] },
  };
  active = job;
  let finish;
  job.done = new Promise((resolve) => {
    finish = resolve;
  });
  let buffer = "";
  let writes = Promise.resolve();
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (data) => {
    buffer = (buffer + data).slice(-64_000);
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event.type === "page") {
        job.progress.saved += event.saved;
        job.progress.pages++;
      }
      if (event.type === "category") job.progress.completedCategories++;
      if (event.type === "start")
        job.progress.totalCategories = event.categories;
      if (event.type === "error") job.error = event.message;
      if (event.type === 'heartbeat') job.progress.heartbeat = event.heartbeat;
      if (event.type === 'finish') {
        job.result = event;
        job.progress.coverage = event.coverage;
        if (event.errors?.length) job.error = event.errors.join('\n').slice(-4000);
      }
      job.progress.events = [...job.progress.events, event].slice(-12);
      const progress = JSON.stringify(job.progress);
      writes = writes
        .then(() =>
          db.query("UPDATE scraper_runs SET progress=$1 WHERE id=$2", [
            progress,
            id,
          ]),
        )
        .catch((error) => console.error("Scraper progress", error.message));
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (data) => {
    job.error = String(data).slice(-2000);
  });
  child.once("error", (error) => {
    job.error = error.message;
  });
  const timeoutMinutes = Number(process.env.SCRAPER_TIMEOUT_MINUTES ?? (options.full ? 0 : 30));
  const timeout =
    timeoutMinutes > 0
      ? setTimeout(
          () => {
            job.timedOut = true;
            job.error = `Превышен лимит времени сбора (${timeoutMinutes} минут)`;
            cancel().catch(console.error);
          },
          timeoutMinutes * 60 * 1000,
        )
      : null;
  timeout?.unref();
  child.once("close", async (code) => {
    clearTimeout(timeout);
    clearTimeout(job.killTimer);
    try {
      await writes;
      const state = job.timedOut
        ? "failed"
        : job.cancelling
          ? "cancelled"
          : job.result?.partial
            ? 'partial'
          : code === 0 && job.result
            ? "completed"
            : "failed";
      await db.query(
        "UPDATE scraper_runs SET status=$1,finished_at=$2,error=$3 WHERE id=$4",
        [
          state,
          new Date().toISOString(),
          state === "failed"
            ? job.error || `Исполнитель завершился с кодом ${code}`
            : null,
          id,
        ],
      );
      await unlink(cancelFile).catch(() => {});
    } catch (error) {
      console.error("Scraper completion", error.message);
    } finally {
      if (active === job) active = null;
      finish();
    }
  });
  return {
    run: {
      id,
      status: "running",
      started_at: startedAt,
      options,
      progress: job.progress,
    },
  };
}

async function cancel() {
  if (!active) {
    const current = await status();
    if (current.run && ['running','cancelling'].includes(current.run.status) &&
        /^[a-f0-9-]{36}$/.test(current.run.id)) {
      await writeFile(path.join(root,'backend/data',`${current.run.id}.cancel`),'cancel');
      await db.query("UPDATE scraper_runs SET status='cancelling' WHERE id=$1 AND status='running'",[current.run.id]);
    }
    return status();
  }
  const job = active;
  job.cancelling = true;
  await writeFile(job.cancelFile, "cancel");
  await db.query(
    "UPDATE scraper_runs SET status='cancelling' WHERE id=$1 AND status='running'",
    [job.id],
  );
  if (!job.killTimer) {
    job.killTimer = setTimeout(() => {
      if (!Number.isInteger(job.child.pid)) return;
      if (process.platform === "win32") {
        execFile(
          "taskkill",
          ["/PID", String(job.child.pid), "/T", "/F"],
          { windowsHide: true },
          () => {},
        );
      } else {
        try {
          process.kill(-job.child.pid, "SIGKILL");
        } catch {}
      }
    }, 120_000);
    job.killTimer.unref();
  }
  return status();
}

async function stop() {
  const job = active;
  if (!job) return;
  await cancel();
  await job.done;
}

module.exports = {
  start,
  status,
  cancel,
  stop,
  recover,
  authorize,
  localAddress,
};
