import { TypeSafeClient, choice, noul } from "@typesafe-ai/sdk";
import "dotenv/config";

//Client Initialization
const client = new TypeSafeClient({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api", // sdk def value change (in docs)
});

async function main() {
  console.log("Testing");
  const start = performance.now();

  const result = await client.systemOne({
    model: "typesafe/jev-1.13",
    state: {
      currentPage: "Google Search Homepage",
      userGoal: "Find the latest Bun release notes",
      availableButtons: [
        "I'm Feeling Lucky",
        "Google Search",
        "Sign In",
        "Settings",
      ],
    },
    questions: {
      bestAction: choice(
        "Which button should the user click to start finding what they want?",
        {
          lucky: "I'm Feeling Lucky",
          search: "Google Search",
          signin: "Sign In",
          settings: "Settings",
        },
      ),
      alreadyDone: noul(
        "Has the user already found the release notes on this screen?",
      ),
    },
  });

  const duration = (performance.now() - start).toFixed(0);
  console.log(`\nDecision received in ${duration}ms!`);
  console.log("Selected Action:", result.answers.bestAction.choice);
  console.log("Confidence:", result.answers.bestAction.confidence);
  console.log("Probabilities:", result.answers.bestAction.probabilities);
  console.log(
    "Probability task is done (Noul):",
    result.answers.alreadyDone.noul,
  );
}

main().catch(console.error);
