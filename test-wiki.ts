import { JevAgent } from "./src/agent";
import "dotenv/config";

async function main() {
  const agent = new JevAgent();

  await agent.run({
    startUrl: "https://search.brave.com/?lang=en-in",
    goal: "Find the best smartphones udner 10k available in India",
    maxSteps: 50,
    headless: false,
  });
}

main().catch(console.error);
