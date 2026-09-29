import { JevAgent } from "./src/agent";
import "dotenv/config";

async function main() {
  const agent = new JevAgent();

  await agent.run({
    startUrl: "https://news.ycombinator.com",
    goal: "Navigate to the 'new' submissions page",
    maxSteps: 3,
    headless: false,
  });
}

main().catch(console.error);
