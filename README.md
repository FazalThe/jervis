# jervis

A browser agent that navigates like a human. It perceives a page as a structured
model (text + a registry of actionable elements), drives real mouse, keyboard,
scroll, tab, and frame input, and asks Jev to choose the next action each step.

## Install

```bash
bun install
```

## Configuration

Copy `.env` and set:

| Variable | Required | Purpose |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | yes | Used by both the TypeSafe client and helper calls. |
| `JERVIS_HELPER_MODEL` | no | Overrides the helper model (default `deepseek/deepseek-v4.1-flash`). |
| `JERVIS_PLANNER_MODEL` | no | Overrides the planner model (default `typesafe/jev-1.13`). |

## Usage

```bash
bun run test-browser.ts     # page info + text smoke
bun run test-dist.ts        # interactive element smoke
bun run test-jev.ts         # raw systemOne smoke
bun run test-loop.ts        # live navigation smoke (Hacker News)
bun run test-wiki.ts        # live end-to-end run
bun run test-perception.ts  # deterministic perception test (no API key)
```

`JevAgent` options:

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

- **Perception.** Each tick waits for the DOM to settle, then builds a
  token-budgeted page model (`src/perception.ts`): URL/title, a registry of
  interactive elements stamped with `data-jev-id` (`el_<n>` in the main frame,
  `f<frame>_el_<n>` in iframes), headings/landmarks, dialogs, scrollable
  regions, and truncated visible text.
- **Decision.** Jev picks the next action from a closed `choice` set over those
  element ids plus meta-actions (`act_scroll`, `act_press_key`, `act_back`,
  `act_wait`, `act_done`, `act_fail`) and a `noul` done check. Parameterized
  values (search text, select option, scroll direction, key) are resolved by the
  helper model, never free-form text into `choice`.
- **Guardrails.** Element actions that produce no page change, or that are picked
  twice on the same URL, are hidden from the choice set to break no-op loops.
  Clicks fall back from real mouse input to a DOM-dispatched click when pointer
  interception or animations block Playwright's actionability wait. Popups are
  followed and iframes are handled transparently.

## Layout

- `src/browser.ts` — Playwright wrapper: tabs/popups, waits, frames, dialogs, full input surface.
- `src/perception.ts` — structured page model + interactive-element registry.
- `src/agent.ts` — planner loop, memory/guardrails, meta-actions.
- `src/llm.ts` — helper LLM calls (field text, option picking, answer extraction).
- `src/types.ts` — shared action/perception types.
- `fixtures/` — local pages for deterministic tests.
