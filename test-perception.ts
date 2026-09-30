import { BrowserController } from "./src/browser";
import { buildPerception } from "./src/perception";

let failures = 0;

function check(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ok   - ${message}`);
  } else {
    failures++;
    console.log(`  FAIL - ${message}`);
  }
}

const fixture = (name: string) => new URL(`./fixtures/${name}`, import.meta.url).href;

async function main() {
  const browser = new BrowserController();
  await browser.launch(true);

  try {
    await browser.goto(fixture("form.html"));
    const form = await buildPerception(browser.activePage()!);
    check(form.actions.some((a) => a.type === "fill"), "form exposes a fill action");
    check(form.actions.some((a) => a.type === "select"), "form exposes a select action");
    check(form.actions.some((a) => a.type === "check"), "form exposes a check action");
    check(
      form.actions.some((a) => a.type === "click" && /send message/i.test(a.label)),
      "form exposes the submit button",
    );
    check(form.headings.some((h) => /contact us/i.test(h)), "heading captured");
    check(form.actions.every((a) => a.id.startsWith("el_")), "main-frame ids use el_ prefix");

    await browser.goto(fixture("popup.html"));
    const popup = await buildPerception(browser.activePage()!);
    const popupLink = popup.actions.find((a) => /open result in a new tab/i.test(a.label));
    check(Boolean(popupLink), "popup link captured");
    if (popupLink) {
      await browser.click(popupLink.id);
      await browser.waitForStable(200, 2000);
      check(browser.pageCount() >= 2, "popup opened as a new tab");
      check(/popup-target\.html$/.test(browser.activeUrl()), "active tab switched to the popup target");
    }

    await browser.goto(fixture("keyboard.html"));
    await browser.performAction({ kind: "press", key: "ArrowLeft" });
    await browser.performAction({ kind: "pressCombo", keys: ["Shift", "A"] });
    await browser.performAction({ kind: "holdKey", key: "ArrowDown", ms: 120 });
    const echo = await browser.getCleanText(800);
    check(/down:ArrowLeft/.test(echo), "press() reaches the page");
    check(/down:ArrowDown/.test(echo), "holdKey() reaches the page");

    await browser.goto(fixture("frames.html"));
    const framed = await buildPerception(browser.activePage()!);
    const inner = framed.actions.find((a) => /inner button/i.test(a.label));
    check(Boolean(inner), "iframe action captured");
    check(inner ? /^f\d+_el_/.test(inner.id) : false, "iframe action id is frame-prefixed");
    if (inner) {
      check(await browser.click(inner.id), "click resolves the owning frame");
    }
  } finally {
    await browser.close();
  }

  if (failures > 0) {
    console.log(`\n${failures} perception assertion(s) failed`);
    process.exit(1);
  }
  console.log("\nall perception assertions passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
