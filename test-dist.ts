import { BrowserController } from "./src/browser";

async function main() {
  const browser = new BrowserController();
  await browser.launch(true);

  console.log("Navigating to Hacker News...");
  await browser.goto("https://news.ycombinator.com");

  console.log("Extracting interactive elements...");
  const actions = await browser.extractActions(15); // Inspect the first 15

  console.log(`\nFound ${actions.length} candidate actions for Jev:`);
  actions.forEach((a) => {
    console.log(`  [${a.id}] -> ${a.label} (${a.type})`);
  });

  await browser.close();
}

main().catch(console.error);
