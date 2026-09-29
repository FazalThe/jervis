import { chromium, type Browser, type Page } from "playwright";

export interface DistilledAction {
  id: string;
  tag: string;
  type: "click" | "fill";
  label: string;
}

export class BrowserController {
  private browser: Browser | null = null;
  private page: Page | null = null;

  async launch(headless = true) {
    this.browser = await chromium.launch({ headless });
    const context = await this.browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent:
        "mozilla/5.0 (macintosh; intel mac os x 10_15_7) applewebkit/537.36 (khtml, like gecko) chrome/120.0.0.0 safari/537.36",
    });
    this.page = await context.newPage();
  }

  async goto(url: string) {
    if (!this.page) throw new Error("browser not launched yet");
    await this.page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
  }

  async getPageInfo() {
    if (!this.page) return { title: "", url: "" };
    return {
      title: await this.page.title(),
      url: this.page.url(),
    };
  }

  async getCleanText(maxCharacters = 2500): Promise<string> {
    if (!this.page) return "";

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const text = await this.page.evaluate(() => {
          return document.body ? document.body.innerText : "";
        });
        return text
          .replace(/\n\s*\n/g, "\n")
          .trim()
          .slice(0, maxCharacters);
      } catch (err: any) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    return "";
  }

  async extractActions(maxElements = 50): Promise<DistilledAction[]> {
    if (!this.page) return [];

    return await this.page.evaluate((limit) => {
      const elements = Array.from(
        document.querySelectorAll(
          'a, button, input, textarea, select, [role="button"], [role="link"]',
        ),
      );

      const actions: DistilledAction[] = [];
      let count = 0;

      for (const el of elements) {
        if (count >= limit) break;

        if (
          el.tagName.toLowerCase() === "div" &&
          el.querySelector("button, a, input, select, textarea")
        ) {
          continue;
        }

        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const isVisible =
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none";
        if (!isVisible) continue;

        const tag = el.tagName.toLowerCase();
        const inputType = el.getAttribute("type") || "";
        const isTextInput =
          tag === "textarea" ||
          (tag === "input" &&
            ["text", "search", "email", "password", ""].includes(inputType));

        const text = (
          el.textContent ||
          el.getAttribute("placeholder") ||
          el.getAttribute("aria-label") ||
          el.getAttribute("title") ||
          (el as HTMLInputElement).value ||
          ""
        )
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, 50);

        if (!text && !isTextInput) continue;

        const actionId = `act_${count}`;
        el.setAttribute("data-jev-id", actionId);

        const type = isTextInput ? "fill" : "click";
        const label = isTextInput
          ? `type into ${tag} (${text || "input field"})`
          : `click ${tag} "${text}"`;

        actions.push({
          id: actionId,
          tag,
          type,
          label,
        });

        count++;
      }

      return actions;
    }, maxElements);
  }

  async performAction(actionId: string, fillText?: string) {
    if (!this.page) return;

    const locator = this.page.locator(`[data-jev-id="${actionId}"]`).first();
    const count = await locator.count();
    if (count === 0) return;

    const tagName = await locator.evaluate((el) => el.tagName.toLowerCase());
    const isTextInput = tagName === "textarea" || tagName === "input";

    if (isTextInput && fillText) {
      await locator.fill(fillText);
      await this.page.keyboard.press("Enter");
    } else {
      await locator.click({ timeout: 2000 }).catch(() => {});
    }

    await new Promise((r) => setTimeout(r, 400));
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }
}
