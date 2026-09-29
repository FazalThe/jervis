import { JevAgent } from "./src/agent";
import "dotenv/config";

async function main() {
  const agent = new JevAgent();

  await agent.run({
    startUrl: "https://search.brave.com/?lang=en-in",
    goal: "go to a tetris program, and play and win it",
    maxSteps: 50,
    headless: false,
  });
}

main().catch(console.error);
