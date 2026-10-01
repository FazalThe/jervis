# Jervis

A browser agent that navigates the web like a human.

Jervis perceives pages as a structured model of text and actionable elements, then uses real mouse, keyboard, scroll, tab, and frame input to interact with them. Jev decides what to do next at each step. A lightweight model handles the user-facing layer, turning user input into initial Jervis instructions and turning the agent's result into a final answer.

Instructions and results can be sent through a Telegram bot.

## Install

```bash
bun install
```

## Configuration

Create a `.env` file in the project root:

| Variable               | Required | Description                                               |
| ---------------------- | :------: | --------------------------------------------------------- |
| `OPENROUTER_API_KEY`   |  **Yes** | OpenRouter API key used by the planner and helper model.  |
| `TELEGRAM_BOT_TOKEN`   |  **Yes** | Token for connecting Jervis to your Telegram bot.         |
| `JERVIS_HELPER_MODEL`  |    No    | Helper model. Defaults to `deepseek/deepseek-v4.1-flash`. |
| `JERVIS_PLANNER_MODEL` |    No    | Planner model. Defaults to `typesafe/jev-1.13`.           |

### Example

```env
OPENROUTER_API_KEY=your_openrouter_api_key
TELEGRAM_BOT_TOKEN=your_telegram_bot_token

# Optional
JERVIS_HELPER_MODEL=deepseek/deepseek-v4.1-flash
JERVIS_PLANNER_MODEL=typesafe/jev-1.13
```

### Telegram

Create a bot through [@BotFather](https://t.me/BotFather):

1. Send `/newbot`.
2. Follow the prompts.
3. Copy the token and set it as `TELEGRAM_BOT_TOKEN`.

## Usage

Start Jervis with:

```bash
bun run index.ts
```

The repository also includes several test scripts:

```bash
bun run test-browser.ts       # page info + text
bun run test-dist.ts          # interactive elements
bun run test-jev.ts           # raw Jev call
bun run test-loop.ts          # live navigation (Hacker News)
bun run test-wiki.ts          # live end-to-end run
bun run test-perception.ts    # deterministic perception test
```

You can also run the agent directly:

```ts
await agent.run({
  startUrl: "https://search.brave.com",
  goal: "find the best smartphones under 10k in india",
  maxSteps: 50,
  maxDurationMs: 300000,
  headless: false,
});
```

## How it works

* **Perception** — Waits for the page to settle, then builds a token-budgeted page model containing the URL, title, visible text, headings, landmarks, dialogs, scrollable regions, and interactive elements.

* **Decision** — Jev chooses the next action from a fixed set of element IDs and meta-actions such as scrolling, key presses, waiting, going back, finishing, or failing. Parameter values such as search text and select options are resolved separately by the helper model.

* **Guardrails** — Repeated or ineffective actions are removed from the available choices to prevent no-op loops. Clicks normally use real mouse input, with a DOM click fallback when Playwright's actionability checks are blocked by things like animations or pointer interception. Popups and iframes are handled as part of the browser layer.

## Layout

```text
src/
├── browser.ts       # Playwright wrapper and browser input
├── perception.ts    # Page model and element registry
├── agent.ts         # Agent loop, memory and guardrails
├── llm.ts           # Helper model calls
├── types.ts         # Shared types
└── tgbot.ts         # Telegram interface

fixtures/             # Local pages for deterministic tests
```
