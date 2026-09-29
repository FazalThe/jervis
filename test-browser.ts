import { BrowserController } from "./src/browser";

async function main() {
  console.log("Launching headless browser...");
  const browser = new BrowserController();

  await browser.launch(true);

  console.log("Navigating to Hacker News...");
  await browser.goto("https://news.ycombinator.com");

  const info = await browser.getPageInfo();
  console.log("\nPage Info:", info);

  const textSample = await browser.getCleanText(500);
  console.log("\n--- Visible Text Sample (First 500 chars) ---");
  console.log(textSample);
  console.log("--------------------------------------------");

  await browser.close();
  console.log("\nBrowser closed successfully.");
}

main().catch(console.error);
