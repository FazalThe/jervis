import { TypeSafeClient, choice, noul } from "@typesafe-ai/sdk";
import { BrowserController } from "./browser";
import { HelperLLM } from "./llm";
import { buildPerception } from "./perception";
import type { Action, DistilledAction, Perception, StepRecord, AgentResult } from "./types";

export interface AgentConfig {
  goal: string;
  startUrl: string;
  maxSteps?: number;
  maxDurationMs?: number;
  headless?: boolean;
}

const KEY_OPTIONS: Record<string, string> = {
  ArrowLeft: "move or select left",
  ArrowRight: "move or select right",
  ArrowUp: "move or select up",
  ArrowDown: "move or select down",
  Space: "press the space bar",
  Enter: "confirm or submit",
  Escape: "close or cancel",
  Tab: "focus the next control",
  Backspace: "delete a character",
};

const SCROLL_OPTIONS: Record<string, string> = {
  down: "scroll down a bit",
  up: "scroll up a bit",
  bottom: "jump to the bottom of the page",
  top: "jump to the top of the page",
};

export class JevAgent {
  private client: TypeSafeClient;
  private browser: BrowserController;
  private helper: HelperLLM;
  private plannerModel: string;
  private noopCounts = new Map<string, number>();
  private attemptCounts = new Map<string, number>();
  private lastUrl = "";

  constructor() {
    this.client = new TypeSafeClient({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api",
    });
    this.browser = new BrowserController();
    this.helper = new HelperLLM();
    this.plannerModel = process.env.JERVIS_PLANNER_MODEL || "typesafe/jev-1.13";
  }

  async run(config: AgentConfig): Promise<AgentResult> {
    const maxSteps = config.maxSteps ?? 40;
    const maxDurationMs = config.maxDurationMs ?? 300000;

    console.log(`\ngoal: "${config.goal}"`);
    console.log(`launching browser to: ${config.startUrl}`);

    let browserLaunched = false;

    try {

      await this.browser.launch(config.headless ?? true);
      browserLaunched = true;
      
      await this.browser.goto(config.startUrl);

      const start = Date.now();
      const history: StepRecord[] = [];
      this.noopCounts.clear();
      this.attemptCounts.clear();
      this.lastUrl = "";

      for (let step = 1; step <= maxSteps; step++) {
        if (Date.now() - start > maxDurationMs) {
          console.log(`\nreached max duration (${maxDurationMs}ms).`);
          return {
            status: "timeout",
            reason: "max duration exceeded"
          };
        }

        console.log(`\n--- step ${step} / ${maxSteps} ---`);
        await this.browser.waitForStable(300, 4000).catch(() => {});

        const page = this.browser.activePage();
        if (!page) return { status: "failed", reason: "no active page" };
        const perception = await buildPerception(page, {
          actionLimit: 60,
          textBudget: 3000,
        });

        if (perception.url !== this.lastUrl) {
          this.lastUrl = perception.url;
          this.noopCounts.clear();
          this.attemptCounts.clear();
        }

        console.log(
          `page: "${perception.title.toLowerCase()}" (${perception.url})`,
        );
        console.log(
          `actions: ${perception.actions.length}  frames: ${perception.frames}  dialogs: ${perception.dialogs}`,
        );

        if (this.browser.pageCount() > 1) {
          console.log(
            `multiple tabs open (${this.browser.pageCount()}); following newest.`,
          );
          await this.browser.switchToNewestPage();
        }

        const response = await this.decide(config, perception, history);
        const chosenId = response.answers.next_action.choice;
        const confidence = (
          response.answers.next_action.confidence * 100
        ).toFixed(0);
        const doneProb = (response.answers.is_done.noul * 100).toFixed(1);
        console.log(
          `jev decision: [${chosenId}] (confidence: ${confidence}%, done: ${doneProb}%)`,
        );

        if (response.answers.is_done.noul > 0.8 || chosenId === "act_done") {
          console.log(`\ngoal verified by jev.`);
          const answer = await this.helper
            .extractAnswer(config.goal, perception.text)
            .catch(() => "");
          console.log(`\nfinal answer: ${answer}\n`);
          return{
            status: "success",
            answer
          };
        }

        if (chosenId === "act_fail") {
          console.log(`\nstopped: jev determined the task is blocked.`);
          return { status: "failed", reason: "task is blocked" };
        }

        const actionKey = `${perception.url}#${chosenId}`;
        if (this.isStalled(history, actionKey)) {
          console.log(`\nstalled: repeated no-op action [${chosenId}].`);
          return { status: "failed", reason: "task is blocked" };
        }

        const outcome = await this.execute(config, perception, chosenId);
        history.push({
          step,
          action: chosenId,
          outcome,
          url: perception.url,
          hash: perception.hash,
        });
        if (history.length > 20) history.shift();
      }

      console.log(`\nreached maximum steps without conclusion.`);
      return {
        status: "failed",
        reason: "max steps reached without conclusion"
      };
    } finally {
      if (browserLaunched) {
        console.log("shutting down browser...");
        await this.browser.close();
      }
    }
  }

  private isStalled(history: StepRecord[], actionKey: string): boolean {
    const recent = history.slice(-2);
    return (
      recent.length === 2 &&
      recent.every((h) => `${h.url}#${h.action}` === actionKey)
    );
  }

  private async decide(
    config: AgentConfig,
    perception: Perception,
    history: StepRecord[],
  ) {
    const choiceOptions: Record<string, string> = {
      act_done:
        "the requested information or goal is visible/complete on this page",
      act_fail: "cannot proceed or blocked",
      act_wait: "wait for elements to load",
      act_press_key: "press a specific keyboard key",
    };

    if (perception.scrollables > 0 || perception.text.length > 2000) {
      choiceOptions.act_scroll = "scroll the page to reveal more content";
    }
    if (perception.url !== config.startUrl && history.length > 0) {
      choiceOptions.act_back = "go back to the previous page";
    }

    for (const act of perception.actions) {
      const attempts = this.attemptCounts.get(act.label) ?? 0;
      const noops = this.noopCounts.get(act.label) ?? 0;
      if (attempts >= 2 || noops >= 1) continue;
      choiceOptions[act.id] =
        attempts >= 1
          ? `${act.label.toLowerCase()} (tried once already; prefer something else)`
          : act.label.toLowerCase();
    }

    const response = await this.client.systemOne({
      model: this.plannerModel,
      state: {
        goal: config.goal,
        current_url: perception.url,
        page_title: perception.title,
        page_model: perception.text,
        recent_actions: history
          .slice(-5)
          .map((h) => `${h.action} -> ${h.outcome}`),
        dialogs: perception.dialogs,
        note: "actions already attempted twice with no progress are hidden; prefer a different action or a meta-action.",
      },
      questions: {
        next_action: choice(
          `which action moves closer to accomplishing: "${config.goal}"?`,
          choiceOptions,
        ),
        is_done: noul(
          `does this page contain the complete answer or fulfill the goal: "${config.goal}"?`,
        ),
      },
    });

    return response;
  }

  private async execute(
    config: AgentConfig,
    perception: Perception,
    chosenId: string,
  ): Promise<string> {
    switch (chosenId) {
      case "act_wait":
        console.log("waiting 2 seconds...");
        await new Promise((r) => setTimeout(r, 2000));
        return "waited";

      case "act_scroll": {
        const direction = await this.helper
          .chooseOption(
            `the user wants to ${config.goal}. which direction should the page scroll?`,
            SCROLL_OPTIONS,
          )
          .catch(() => "down");
        await this.scroll(direction ?? "down");
        return `scrolled ${direction ?? "down"}`;
      }

      case "act_press_key": {
        const key = await this.helper
          .chooseOption(
            `the user wants to ${config.goal}. which keyboard key should be pressed?`,
            KEY_OPTIONS,
          )
          .catch(() => "Enter");
        await this.browser.performAction({
          kind: "press",
          key: key ?? "Enter",
        });
        return `pressed ${key ?? "Enter"}`;
      }

      case "act_back":
        await this.browser.back();
        return "navigated back";

      default: {
        const target = perception.actions.find((a) => a.id === chosenId);
        if (!target) {
          return "action not found";
        }
        return await this.dispatchElementAction(config, target);
      }
    }
  }

  private async dispatchElementAction(
    config: AgentConfig,
    target: DistilledAction,
  ): Promise<string> {
    console.log(`executing: ${target.label}`);
    this.attemptCounts.set(
      target.label,
      (this.attemptCounts.get(target.label) ?? 0) + 1,
    );
    let action: Action;
    switch (target.type) {
      case "fill": {
        const query = await this.helper
          .getSearchQuery(config.goal, target.label)
          .catch(() => config.goal);
        console.log(`typing: "${query}"`);
        action = { kind: "fill", id: target.id, text: query };
        break;
      }
      case "select": {
        const value = await this.pickOption(config.goal, target);
        action = { kind: "select", id: target.id, value };
        break;
      }
      case "check":
        action = target.checked
          ? { kind: "uncheck", id: target.id }
          : { kind: "check", id: target.id };
        break;
      case "hover":
        action = { kind: "hover", id: target.id };
        break;
      default:
        action = { kind: "click", id: target.id };
    }

    const before = await this.browser.pageSignature();
    const ok = await this.browser.performAction(action);
    if (ok && action.kind === "fill") {
      await this.browser.performAction({ kind: "press", key: "Enter" });
    }
    await this.browser.waitForStable(250, 2500).catch(() => {});
    const after = await this.browser.pageSignature();

    if (after === before) {
      const misses = (this.noopCounts.get(target.label) ?? 0) + 1;
      this.noopCounts.set(target.label, misses);
      return `no visible change (${target.type}, miss ${misses})`;
    }
    this.noopCounts.delete(target.label);
    return ok
      ? `ok (${target.type})`
      : `failed (${target.type}; element vanished)`;
  }

  private async pickOption(
    goal: string,
    target: DistilledAction,
  ): Promise<string> {
    const options = target.options?.filter(Boolean) ?? [];
    if (options.length === 0) return target.name;
    const map: Record<string, string> = {};
    for (const option of options) map[option] = option;
    const picked = await this.helper
      .chooseOption(
        `the user wants to ${goal}. which option should be selected in "${target.name}"?`,
        map,
      )
      .catch(() => null);
    return picked ?? options[0] ?? target.name;
  }

  private async scroll(direction: string): Promise<void> {
    switch (direction) {
      case "up":
        await this.browser.performAction({ kind: "scrollBy", dx: 0, dy: -600 });
        break;
      case "bottom":
        await this.browser.performAction({ kind: "scrollToBottom" });
        break;
      case "top":
        await this.browser.performAction({ kind: "scrollToTop" });
        break;
      default:
        await this.browser.performAction({ kind: "scrollBy", dx: 0, dy: 600 });
    }
  }
}
