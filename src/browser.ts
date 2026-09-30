import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "playwright";
import { collectInteractive } from "./perception";
import type { Action, DistilledAction, Rect } from "./types";

const USER_AGENT =
  "mozilla/5.0 (macintosh; intel mac os x 10_15_7) applewebkit/537.36 (khtml, like gecko) chrome/120.0.0.0 safari/537.36";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class BrowserController {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private dialogPolicy: "dismiss" | "accept" = "dismiss";
  private dialogLog: string[] = [];
  private registered = new WeakSet<Page>();

  async launch(headless = true) {
    this.browser = await chromium.launch({ headless });
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: USER_AGENT,
    });
    this.context.on("page", (page) => this.registerPage(page));
    const page = await this.context.newPage();
    this.registerPage(page);
    this.page = page;
    if (!headless) await page.bringToFront().catch(() => {});
  }

  private registerPage(page: Page) {
    if (this.registered.has(page)) return;
    this.registered.add(page);
    page.on("dialog", (dialog) => {
      const entry = `${dialog.type()}: ${dialog.message()}`;
      this.dialogLog.push(entry);
      console.log(`[browser] dialog -> ${entry}`);
      if (this.dialogPolicy === "accept") void dialog.accept().catch(() => {});
      else void dialog.dismiss().catch(() => {});
    });
  }

  private ensurePage(): Page {
    const page = this.activePage();
    if (!page) throw new Error("browser not launched yet");
    return page;
  }

  pages(): Page[] {
    return this.context?.pages().filter((p) => !p.isClosed()) ?? [];
  }

  pageCount(): number {
    return this.pages().length;
  }

  activePage(): Page | null {
    if (this.page && !this.page.isClosed()) return this.page;
    const newest = this.pages().at(-1) ?? null;
    this.page = newest;
    return newest;
  }

  activeUrl(): string {
    return this.activePage()?.url() ?? "";
  }

  async switchToNewestPage(): Promise<Page | null> {
    const newest = this.pages().at(-1) ?? null;
    if (newest) {
      this.page = newest;
      await newest.bringToFront().catch(() => {});
    }
    return newest;
  }

  async closeExtraPages() {
    const active = this.activePage();
    for (const page of this.pages()) {
      if (page !== active) await page.close().catch(() => {});
    }
  }

  getDialogs(): string[] {
    return [...this.dialogLog];
  }

  setDialogPolicy(policy: "dismiss" | "accept") {
    this.dialogPolicy = policy;
  }

  async goto(url: string) {
    const page = this.ensurePage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await this.waitForStable(300, 4000).catch(() => {});
  }

  async back() {
    await this.ensurePage()
      .goBack({ waitUntil: "domcontentloaded", timeout: 15000 })
      .catch(() => {});
  }

  async forward() {
    await this.ensurePage()
      .goForward({ waitUntil: "domcontentloaded", timeout: 15000 })
      .catch(() => {});
  }

  async reload() {
    await this.ensurePage()
      .reload({ waitUntil: "domcontentloaded", timeout: 15000 })
      .catch(() => {});
  }

  async waitForLoad(
    state: "load" | "domcontentloaded" | "networkidle" = "domcontentloaded",
    timeout = 15000,
  ) {
    await this.ensurePage()
      .waitForLoadState(state, { timeout })
      .catch(() => {});
  }

  async waitForNetworkIdle(timeout = 3000) {
    await this.ensurePage()
      .waitForLoadState("networkidle", { timeout })
      .catch(() => {});
  }

  async waitForStable(windowMs = 300, capMs = 5000) {
    const page = this.activePage();
    if (!page) return;
    await page
      .evaluate(
        ({ quiet, cap }) =>
          new Promise<void>((resolve) => {
            let timer: ReturnType<typeof setTimeout> | undefined;
            let capTimer: ReturnType<typeof setTimeout> | undefined;
            let finished = false;
            const done = () => {
              if (finished) return;
              finished = true;
              observer.disconnect();
              clearTimeout(timer);
              clearTimeout(capTimer);
              resolve();
            };
            const observer = new MutationObserver(() => {
              clearTimeout(timer);
              timer = setTimeout(done, quiet);
            });
            try {
              observer.observe(document.documentElement, {
                subtree: true,
                childList: true,
                attributes: true,
                characterData: true,
              });
            } catch {
              done();
              return;
            }
            capTimer = setTimeout(done, cap);
            timer = setTimeout(done, quiet);
          }),
        { quiet: windowMs, cap: capMs },
      )
      .catch(() => {});
  }

  async getPageInfo() {
    const page = this.activePage();
    if (!page) return { title: "", url: "" };
    return { title: await page.title().catch(() => ""), url: page.url() };
  }

  async getCleanText(maxCharacters = 2500): Promise<string> {
    const page = this.activePage();
    if (!page) return "";
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const text = await page.evaluate(() =>
          document.body ? document.body.innerText : "",
        );
        return text
          .replace(/\n\s*\n/g, "\n")
          .trim()
          .slice(0, maxCharacters);
      } catch {
        await sleep(200);
      }
    }
    return "";
  }

  async pageSignature(): Promise<string> {
    const page = this.activePage();
    if (!page) return "";
    try {
      const inner = await page.evaluate(
        () =>
          `${document.title}|${document.body ? document.body.innerText.length : 0}|${document.querySelectorAll("*").length}`,
      );
      return `${page.url()}|${this.pageCount()}|${inner}`;
    } catch {
      return `${page.url()}|${this.pageCount()}`;
    }
  }

  async extractActions(maxElements = 50): Promise<DistilledAction[]> {
    const page = this.activePage();
    if (!page) return [];
    return collectInteractive(page, maxElements);
  }

  private async resolveLocator(id: string): Promise<Locator | null> {
    const page = this.activePage();
    if (!page) return null;
    const selector = `[data-jev-id="${id}"]`;
    for (const frame of page.frames()) {
      try {
        const base = frame.locator(selector);
        if ((await base.count()) > 0) return base.first();
      } catch {}
    }
    return null;
  }

  private async settleAfterAction(
    before: number,
    beforeUrl: string,
  ): Promise<boolean> {
    for (let i = 0; i < 8; i++) {
      if (this.pageCount() > before || this.activeUrl() !== beforeUrl) break;
      await sleep(100);
    }
    if (this.pageCount() > before) {
      await this.switchToNewestPage();
      await this.activePage()
        ?.waitForLoadState("domcontentloaded", { timeout: 4000 })
        .catch(() => {});
      return true;
    }
    return false;
  }

  private async robustClick(
    locator: Locator,
  ): Promise<{ ok: boolean; method: string; error?: string }> {
    try {
      await locator.click({ timeout: 1200 });
      return { ok: true, method: "mouse" };
    } catch (err) {
      const reason =
        err instanceof Error
          ? (err.message.split("\n")[0] ?? err.message)
          : String(err);
      try {
        await locator.evaluate((el) => (el as HTMLElement).click());
        return { ok: true, method: "dom", error: reason };
      } catch {
        try {
          await locator.dispatchEvent("click");
          return { ok: true, method: "dispatch", error: reason };
        } catch {
          return { ok: false, method: "", error: reason };
        }
      }
    }
  }

  async click(id: string): Promise<boolean> {
    const locator = await this.resolveLocator(id);
    if (!locator) return false;
    const before = this.pageCount();
    const beforeUrl = this.activeUrl();
    const result = await this.robustClick(locator);
    const followed = await this.settleAfterAction(before, beforeUrl);
    if (!result.ok && !followed) {
      console.log(`[browser] click ${id} FAILED: ${result.error}`);
    } else if (result.method !== "mouse") {
      console.log(
        `[browser] click ${id} via ${result.method} fallback (${result.error ?? "ok"})`,
      );
    }
    return result.ok || followed;
  }

  async fill(id: string, text: string): Promise<boolean> {
    const locator = await this.resolveLocator(id);
    if (!locator) return false;
    await locator.fill(text, { timeout: 3000 }).catch(() => {});
    return true;
  }

  async select(id: string, value: string): Promise<boolean> {
    const locator = await this.resolveLocator(id);
    if (!locator) return false;
    await locator.selectOption({ label: value }).catch(async () => {
      await locator.selectOption(value).catch(() => {});
    });
    return true;
  }

  async hover(id: string): Promise<boolean> {
    const locator = await this.resolveLocator(id);
    if (!locator) return false;
    await locator.hover({ timeout: 3000 }).catch(() => {});
    return true;
  }

  async check(id: string, checked: boolean): Promise<boolean> {
    const locator = await this.resolveLocator(id);
    if (!locator) return false;
    if (checked) await locator.check({ timeout: 3000 }).catch(() => {});
    else await locator.uncheck({ timeout: 3000 }).catch(() => {});
    return true;
  }

  async clickAt(x: number, y: number): Promise<boolean> {
    const page = this.activePage();
    if (!page) return false;
    const before = this.pageCount();
    const beforeUrl = this.activeUrl();
    await page.mouse.click(x, y).catch(() => {});
    await this.settleAfterAction(before, beforeUrl);
    return true;
  }

  async hoverAt(x: number, y: number): Promise<boolean> {
    const page = this.activePage();
    if (!page) return false;
    await page.mouse.move(x, y).catch(() => {});
    return true;
  }

  async type(text: string): Promise<void> {
    await this.ensurePage().keyboard.type(text);
  }

  async press(key: string): Promise<void> {
    await this.ensurePage().keyboard.press(key);
  }

  async pressCombo(keys: string[]): Promise<void> {
    const page = this.ensurePage();
    const norm = keys.map((k) => k.trim()).filter(Boolean);
    for (const key of norm) await page.keyboard.down(key);
    for (const key of [...norm].reverse()) await page.keyboard.up(key);
  }

  async holdKey(key: string, ms: number): Promise<void> {
    const page = this.ensurePage();
    await page.keyboard.down(key);
    await sleep(ms);
    await page.keyboard.up(key);
  }

  async scrollBy(dx: number, dy: number): Promise<void> {
    await this.ensurePage().mouse.wheel(dx, dy);
  }

  async scrollToElement(id: string): Promise<boolean> {
    const locator = await this.resolveLocator(id);
    if (!locator) return false;
    await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    return true;
  }

  async scrollToTop(): Promise<void> {
    await this.ensurePage().evaluate(() => window.scrollTo(0, 0));
  }

  async scrollToBottom(): Promise<void> {
    await this.ensurePage().evaluate(() =>
      window.scrollTo(0, document.body.scrollHeight),
    );
  }

  async screenshot(
    opts?: { fullPage?: boolean; elementId?: string; rect?: Rect },
    type: "png" | "jpeg" = "png",
  ): Promise<Buffer> {
    const page = this.ensurePage();
    if (opts?.elementId) {
      const locator = await this.resolveLocator(opts.elementId);
      if (locator) return await locator.screenshot({ type });
    }
    const options: { fullPage?: boolean; type: "png" | "jpeg"; clip?: Rect } = {
      type,
    };
    if (opts?.fullPage) options.fullPage = true;
    if (opts?.rect) options.clip = opts.rect;
    return await page.screenshot(options);
  }

  async performAction(action: Action): Promise<boolean> {
    switch (action.kind) {
      case "click":
        return this.click(action.id);
      case "fill":
        return this.fill(action.id, action.text);
      case "select":
        return this.select(action.id, action.value);
      case "hover":
        return this.hover(action.id);
      case "check":
        return this.check(action.id, true);
      case "uncheck":
        return this.check(action.id, false);
      case "clickAt":
        return this.clickAt(action.x, action.y);
      case "hoverAt":
        return this.hoverAt(action.x, action.y);
      case "type":
        await this.type(action.text);
        if (action.submit) await this.press("Enter");
        return true;
      case "press":
        await this.press(action.key);
        return true;
      case "pressCombo":
        await this.pressCombo(action.keys);
        return true;
      case "holdKey":
        await this.holdKey(action.key, action.ms);
        return true;
      case "scrollBy":
        await this.scrollBy(action.dx, action.dy);
        return true;
      case "scrollToElement":
        return this.scrollToElement(action.id);
      case "scrollToTop":
        await this.scrollToTop();
        return true;
      case "scrollToBottom":
        await this.scrollToBottom();
        return true;
      case "back":
        await this.back();
        return true;
      case "forward":
        await this.forward();
        return true;
      case "reload":
        await this.reload();
        return true;
      case "wait":
        await sleep(action.ms);
        return true;
      default: {
        const exhaustive: never = action;
        return exhaustive;
      }
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
      this.context = null;
      this.page = null;
    }
  }
}
