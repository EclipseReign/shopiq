import {
  fetchNavigation,
  fetchCategoryPage,
  normalizeProduct,
} from "../../shared/kaspi.mjs";
import { database, value, fail, positive, digest } from "./core";
import { sourceOptions } from "./source";

export async function rows(query: any) {
  const result: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = value(await query.range(offset, offset + 999)) as any[];
    result.push(...page);
    if (page.length < 1000) return result;
  }
}

export async function coverage(env: Env) {
  const client = database(env);
  const discovery: any = value(
    await client
      .from("catalog_discoveries")
      .select("*")
      .eq("status", "completed")
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
  const run: any = value(
    await client
      .from("collection_runs")
      .select("id,status,options,progress,started_at,finished_at,error")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
  const tasks = run
    ? await rows(
        client
          .from("collection_tasks")
          .select("*,categories(name,source_code)")
          .eq("run_id", run.id)
          .order("category_id"),
      )
    : [];
  const summary: any = {
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
    cancelled: 0,
  };
  for (const task of tasks) {
    summary[task.status] = (summary[task.status] || 0) + 1;
    summary.pages += task.pages_done;
    summary.found += task.found_count;
    if (task.expected_latest === null) summary.unknown++;
    else summary.expected += task.expected_latest;
  }
  const complete = tasks.length > 0 && summary.completed === tasks.length;
  return {
    discovery,
    runId: run?.id || null,
    summary,
    complete,
    fullCatalogComplete:
      complete &&
      !run.options.categoryId &&
      tasks.length === discovery?.leaves_count,
    scope: {
      categoryId: run?.options.categoryId || null,
      cityId: run?.options.cityId || null,
      full: run?.options.full || false,
    },
    tasks: tasks.map((task) => ({
      ...task,
      name: task.categories?.name,
      source_code: task.categories?.source_code,
      categories: undefined,
    })),
  };
}

export async function startCollection(env: Env, input: any, actor: string) {
  const categoryId = input.categoryId ? positive(input.categoryId, 0) : null;
  const maxPages = positive(input.maxPages, 3, 100);
  const cityId = String(input.cityId || "750000000");
  if (
    !/^\d{9}$/.test(cityId) ||
    (input.full !== undefined && typeof input.full !== "boolean")
  )
    fail(400, "Проверьте город и режим сбора");
  const client = database(env);
  const categories = await rows(
    client
      .from("categories")
      .select("id,parent_id,source_active,source_code")
      .order("id"),
  );
  const active = categories.filter(
    (c) => c.source_active === 1 && c.source_code,
  );
  const parents = new Set(active.map((c) => c.parent_id));
  let selected = new Set(active.map((c) => c.id));
  if (categoryId) {
    selected = new Set([categoryId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const c of active)
        if (selected.has(c.parent_id) && !selected.has(c.id)) {
          selected.add(c.id);
          changed = true;
        }
    }
  }
  const leaves = active.filter((c) => selected.has(c.id) && !parents.has(c.id));
  if (!leaves.length)
    fail(400, "Категория отсутствует в актуальном дереве Kaspi");
  const run = {
    id: value(
      await client.rpc("create_collection", {
        actor,
        options: {
          categoryId,
          cityId,
          maxPages,
          full: input.full === true,
          engine: "http",
        },
        categories: leaves.map((c) => c.id),
      }),
    ),
  };
  try {
    // Cron recovers persisted pending tasks if dispatch is interrupted.
    for (let offset = 0; offset < leaves.length; offset += 100)
      await env.JOBS.sendBatch(
        leaves.slice(offset, offset + 100).map((c) => ({
          body: { kind: "category", runId: run.id, categoryId: c.id },
        })),
      );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "collection_dispatch_interrupted",
        runId: run.id,
      }),
    );
    // Tasks that reached the database remain resumable through the scheduler.
    return collectionStatus(env);
  }
  return collectionStatus(env);
}

export async function collectionStatus(env: Env) {
  const run: any = value(
    await database(env)
      .from("collection_runs")
      .select("id,status,started_at,finished_at,options,progress,error")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
  if (run)
    run.progress = {
      ...run.progress,
      saved: run.progress.found || 0,
      pages: run.progress.pages || 0,
      completedCategories:
        (run.progress.completed || 0) +
        (run.progress.limited || 0) +
        (run.progress.partial || 0),
      totalCategories: run.progress.total || 0,
    };
  return { run };
}

export async function collectPage(env: Env, job: any) {
  const client = database(env);
  const run: any = value(
    await client
      .from("collection_runs")
      .select("status,options")
      .eq("id", job.runId)
      .single(),
  );
  if (run.status !== "running") return;
  const task: any = value(
    await client
      .from("collection_tasks")
      .select("*,categories(source_code)")
      .eq("run_id", job.runId)
      .eq("category_id", job.categoryId)
      .single(),
  );
  if (!["pending", "running"].includes(task.status)) return;
  try {
    const pageInfo = job.page === task.next_page ? job.pageInfo : undefined;
    const result = await fetchCategoryPage(
      task.categories.source_code,
      task.city_id,
      task.next_page,
      { pageInfo, ...sourceOptions(env) },
    );
    const products: any[] = [];
    let invalidCount = 0;
    for (const card of result.cards) {
      try {
        const product: any = normalizeProduct(
          card,
          task.category_id,
          task.city_id,
        );
        product.legacy_key =
          "legacy:" +
          (await digest(
            `${task.category_id}|${product.name.toLowerCase().trim().replace(/\s+/g, " ")}`,
          ));
        products.push(product);
      } catch {
        invalidCount++;
      }
    }
    if (result.cards.length && !products.length)
      throw new Error("Не удалось распознать карточки источника");
    const unique = [
      ...new Map(products.map((p) => [p.external_id, p])).values(),
    ];
    const limited =
      !run.options.full && task.next_page + 1 >= run.options.maxPages;
    const committed: any = value(
      await client.rpc("commit_collection_page", {
        input: {
          runId: job.runId,
          categoryId: task.category_id,
          cityId: task.city_id,
          page: task.next_page,
          products: unique,
          signature: await digest(
            unique
              .map((p) => p.external_id)
              .sort()
              .join("|"),
          ),
          total: result.total,
          pageSize: result.pageSize,
          hasMore: result.hasMore,
          invalidCount,
          limited,
        },
      }),
    );
    if (
      !committed.duplicate &&
      !committed.stopped &&
      result.hasMore &&
      !limited
    )
      await env.JOBS.send(
        { ...job, page: task.next_page + 1, pageInfo: result.pageInfo },
        { delaySeconds: 2 },
      );
    value(await client.rpc("collection_progress", { run: job.runId }));
  } catch (error) {
    throw Object.assign(error, {
      collectionTask: { runId: job.runId, categoryId: job.categoryId },
    });
  }
}

export async function discover(env: Env, cityId = "750000000") {
  const nodes = await fetchNavigation(cityId, sourceOptions(env));
  return value(
    await database(env).rpc("replace_navigation", { nodes, city: cityId }),
  );
}

export async function resumePending(env: Env) {
  const client = database(env);
  const runs = value(
    await client.from("collection_runs").select("id").eq("status", "running"),
  );
  for (const run of runs) {
    const tasks = value(
      await client
        .from("collection_tasks")
        .select("category_id")
        .eq("run_id", run.id)
        .in("status", ["pending", "running"])
        .lt("updated_at", new Date(Date.now() - 10 * 60000).toISOString())
        .limit(100),
    );
    if (tasks.length)
      await env.JOBS.sendBatch(
        tasks.map((task) => ({
          body: {
            kind: "category",
            runId: run.id,
            categoryId: task.category_id,
          },
        })),
      );
    value(await client.rpc("collection_progress", { run: run.id }));
  }
}
