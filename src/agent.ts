import { TypeSafeClient, choice, noul } from "@typesafe-ai/sdk";
import { BrowserController } from "./browser";
import { HelperLLM } from "./llm";

export interface AgentConfig {
  goal: string;
  startUrl: string;
  maxSteps?: number;
  headless?: boolean;
}

export class JevAgent {
  private client: TypeSafeClient;
  private browser: BrowserController;
  private helper: HelperLLM;

  constructor() {
    this.client = new TypeSafeClient({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api",
    });
    this.browser = new BrowserController();
    this.helper = new HelperLLM();
  }

  async run(config: AgentConfig) {
    const maxSteps = config.maxSteps ?? 6;
    console.log(`\ngoal: "${config.goal}"`);
    console.log(`launching browser to: ${config.startUrl}`);

    await this.browser.launch(config.headless ?? true);

    try {
      await this.browser.goto(config.startUrl);

      for (let step = 1; step <= maxSteps; step++) {
        console.log(`\n--- step ${step} / ${maxSteps} ---`);

        //perceive
        const pageInfo = await this.browser.getPageInfo();
        const pageText = await this.browser.getCleanText(2500);
        const actions = await this.browser.extractActions(50);

        console.log(
          `page: "${pageInfo.title.toLowerCase()}" (${pageInfo.url})`,
        );
        console.log(`actions available: ${actions.length}`);

        //frame candidate choices for jev
        const choiceOptions: Record<string, string> = {
          act_done: "the requested information or goal is visible on this page",
          act_wait: "wait for elements to load",
          act_fail: "cannot proceed or blocked",
        };

        for (const act of actions) {
          choiceOptions[act.id] = act.label.toLowerCase();
        }

        //evaluate with jev
        const startTime = performance.now();
        const response = await this.client.systemOne({
          model: "typesafe/jev-1.13",
          state: {
            goal: config.goal,
            current_url: pageInfo.url,
            page_title: pageInfo.title,
            page_snippet: pageText,
          },
          questions: {
            next_action: choice(
              `which action moves closer to accomplishing: "${config.goal}"?`,
              choiceOptions,
            ),
            is_done: noul(
              `does this page text contain the complete answer or fulfill the goal: "${config.goal}"?`,
            ),
          },
        });

        const elapsed = (performance.now() - startTime).toFixed(0);
        const chosenId = response.answers.next_action.choice;
        const confidence = (
          response.answers.next_action.confidence * 100
        ).toFixed(0);
        const doneProb = (response.answers.is_done.noul * 100).toFixed(1);

        console.log(
          `jev decision in ${elapsed}ms: [${chosenId}] (confidence: ${confidence}%, done probability: ${doneProb}%)`,
        );

        //check if done
        if (response.answers.is_done.noul > 0.8 || chosenId === "act_done") {
          console.log(`\ngoal verified by jev.`);
          const answer = await this.helper.extractAnswer(config.goal, pageText);
          console.log(`\nfinal answer: ${answer}\n`);
          return true;
        }

        if (chosenId === "act_fail") {
          console.log(`\nstopped: jev determined task is blocked.`);
          return false;
        }

        if (chosenId === "act_wait") {
          console.log(`waiting 2 seconds...`);
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }

        //execute
        const targetAction = actions.find((a) => a.id === chosenId);
        if (!targetAction) {
          console.log(`selected action not found on page, skipping.`);
          continue;
        }

        console.log(`executing: ${targetAction.label.toLowerCase()}`);

        if (targetAction.type === "fill") {
          const query = await this.helper.getSearchQuery(
            config.goal,
            targetAction.label,
          );
          console.log(`typing query: "${query}"`);
          await this.browser.performAction(targetAction.id, query);
        } else {
          await this.browser.performAction(targetAction.id);
        }
      }

      console.log(`\nreached maximum steps without conclusion.`);
      return false;
    } finally {
      console.log("shutting down browser...");
      await this.browser.close();
    }
  }
}
