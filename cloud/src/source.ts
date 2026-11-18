import { DurableObject } from "cloudflare:workers";
import puppeteer, { type Browser, type Page } from "@cloudflare/puppeteer";

type SourceRequest = {
  path: string;
  cityId: string;
  body?: Record<string, unknown>;
};
type SourceResult = { status: number; text: string };

// The coordination unit is Kaspi's shared browser session. Catalog reads,
// merchant data and other API requests run outside this object.
export class KaspiSource extends DurableObject<Env> {
  private pending = Promise.resolve();
  private browser?: Browser;
  private page?: Page;
  private session?: { id: string; lastUsed: number };
  private cache = new Map<string, { expires: number; result: SourceResult }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.session = await ctx.storage.get("session");
    });
  }

  request(input: SourceRequest): Promise<SourceResult> {
    const operation = this.pending.then(() => this.readSource(input));
    this.pending = operation.then(
      () => {},
      () => {},
    );
    return operation;
  }

  private async openPage() {
    if (this.browser?.connected && this.page && !this.page.isClosed())
      return this.page;
    if (this.session) {
      try {
        this.browser = await puppeteer.connect(
          this.env.BROWSER,
          this.session.id,
        );
      } catch {
        this.session = undefined;
      }
    }
    if (!this.browser?.connected) {
      const limits = await puppeteer.limits(this.env.BROWSER);
      if (!limits.allowedBrowserAcquisitions)
        throw Object.assign(new Error("Browser is busy"), {
          status: 429,
          retryAfter: 20,
        });
      const browser = await puppeteer.launch(this.env.BROWSER, {
        keep_alive: 60000,
      });
      this.session = { id: browser.sessionId(), lastUsed: Date.now() };
      await this.ctx.storage.put("session", this.session);
      this.browser = browser;
    }
    this.page = await this.browser.newPage();
    await this.page.setRequestInterception(true);
    this.page.on("request", (request) => {
      const url = new URL(request.url());
      const host = url.hostname;
      const allowed =
        url.protocol === "https:" &&
        (host === "kaspi.kz" || host.endsWith(".cdn-kaspi.kz"));
      if (
        !allowed ||
        ["image", "media", "font"].includes(request.resourceType())
      )
        request.abort().catch(() => {});
      else request.continue().catch(() => {});
    });
    await this.page.goto("https://kaspi.kz/shop/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    return this.page;
  }

  private async readSource(input: SourceRequest): Promise<SourceResult> {
    const target = new URL(input.path, "https://kaspi.kz");
    if (
      target.origin !== "https://kaspi.kz" ||
      !/^\d{9}$/.test(input.cityId) ||
      !/^\/yml\/(?:main-navigation\/n\/n\/desktop-menu|product-view\/pl\/(?:filters|results)|offer-view\/offers\/\d{1,20})$/.test(
        target.pathname,
      )
    )
      throw new Error("Invalid source request");
    const key = JSON.stringify(input);
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.result;
    try {
      const page = await this.openPage();
      const response = await page.evaluate(async (input) => {
        const response = await fetch(input.path, {
          method: input.body ? "POST" : "GET",
          headers: {
            Accept: "application/json",
            "X-KS-City": input.cityId,
            ...(input.body ? { "Content-Type": "application/json" } : {}),
          },
          body: input.body ? JSON.stringify(input.body) : undefined,
          signal: AbortSignal.timeout(
            input.path.includes("main-navigation") ? 90000 : 30000,
          ),
        });
        const reader = response.body?.getReader();
        if (!reader) throw new Error("Empty source response");
        const decoder = new TextDecoder();
        let text = "",
          size = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 16 * 1024 * 1024) {
            await reader.cancel();
            throw new Error("Source response too large");
          }
          text += decoder.decode(value, { stream: true });
        }
        return { status: response.status, text: text + decoder.decode() };
      }, input);
      let data;
      try {
        data = JSON.parse(response.text);
      } catch {
        data = { error: "Source returned an unexpected response" };
      }
      if (response.status === 200) {
        data._shopiq_observed_at = new Date().toISOString();
      }
      const result = { status: response.status, text: JSON.stringify(data) };
      if (response.status === 200) {
        const ttl = target.pathname.includes("main-navigation")
          ? 6 * 3600000
          : 60000;
        this.cache.set(key, { expires: Date.now() + ttl, result });
        if (this.cache.size > 128)
          this.cache.delete(this.cache.keys().next().value!);
      }
      return result;
    } catch (error) {
      console.error(
        JSON.stringify({ event: "browser_source_failed", name: error.name }),
      );
      return {
        status: 503,
        text: JSON.stringify({ error: "Source temporarily unavailable" }),
      };
    } finally {
      if (this.session) {
        this.session.lastUsed = Date.now();
        await this.ctx.storage.put("session", this.session);
        await this.ctx.storage.setAlarm(this.session.lastUsed + 10000);
      }
    }
  }

  async alarm() {
    await this.pending;
    if (!this.session) return;
    const closeAfter = this.session.lastUsed + 10000;
    if (Date.now() < closeAfter) {
      await this.ctx.storage.setAlarm(closeAfter);
      return;
    }
    await this.browser?.close().catch(() => {});
    if (!this.browser)
      await this.env.BROWSER.closeSession(this.session.id).catch(() => {});
    await this.ctx.storage.delete("session");
    this.browser = undefined;
    this.page = undefined;
    this.session = undefined;
  }
}

export function sourceOptions(env: Env) {
  return {
    fetcher: async (target: URL, init: RequestInit) => {
      const result = await env.KASPI_SOURCE.getByName("kaspi.kz").request({
        path: target.pathname + target.search,
        cityId: new Headers(init.headers).get("X-KS-City")!,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      });
      return new Response(result.text, {
        status: result.status,
        headers: { "Content-Type": "application/json" },
      });
    },
  };
}
