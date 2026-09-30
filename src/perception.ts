import type { Frame, Page } from "playwright";
import type {
  DistilledAction,
  ElementActionType,
  Perception,
  Rect,
} from "./types";

interface RawInteractive {
  id: string;
  tag: string;
  type: ElementActionType;
  label: string;
  role: string;
  name: string;
  rect: Rect;
  enabled: boolean;
  checked?: boolean;
  expanded?: boolean;
  placeholder?: string;
  options?: string[];
}

interface FrameStructure {
  headings: string[];
  landmarks: string[];
  dialogs: number;
  scrollables: number;
  text: string;
}

export interface PerceptionOptions {
  actionLimit?: number;
  textBudget?: number;
  snapshotBudget?: number;
}

const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "textarea",
  "select",
  "summary",
  '[role="button"]',
  '[role="link"]',
  '[role="textbox"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="combobox"]',
  '[role="menuitem"]',
  '[role="tab"]',
  '[role="switch"]',
  '[contenteditable="true"]',
  "[onclick]",
].join(",");

function collectInPage(args: {
  prefix: string;
  limit: number;
  selector: string;
}): RawInteractive[] {
  const { prefix, limit, selector } = args;
  const out: RawInteractive[] = [];
  const seen = new Set<Element>();
  let count = 0;

  const attr = (el: Element, name: string) => el.getAttribute(name) || "";

  const elements = Array.from(document.querySelectorAll(selector));

  for (const el of elements) {
    if (count >= limit) break;
    if (seen.has(el)) continue;
    seen.add(el);

    const tag = el.tagName.toLowerCase();
    if (
      (tag === "div" || tag === "span") &&
      el.querySelector("button, a[href], input, select, textarea")
    ) {
      continue;
    }

    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const visible =
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      style.opacity !== "0";
    if (!visible) continue;

    const inputType = (attr(el, "type") || "").toLowerCase();
    const explicitRole = attr(el, "role");
    const disabled =
      (el as HTMLInputElement).disabled === true ||
      attr(el, "aria-disabled") === "true";

    const isTextInput =
      tag === "textarea" ||
      el.getAttribute("contenteditable") === "true" ||
      (tag === "input" &&
        [
          "text",
          "search",
          "email",
          "password",
          "url",
          "tel",
          "number",
          "",
        ].includes(inputType));

    let type: ElementActionType = "click";
    if (isTextInput) type = "fill";
    else if (tag === "select") type = "select";
    else if (
      tag === "input" &&
      (inputType === "checkbox" || inputType === "radio")
    )
      type = "check";

    const role =
      explicitRole ||
      (tag === "a"
        ? "link"
        : tag === "button" ||
            (tag === "input" &&
              ["submit", "button", "reset", "image"].includes(inputType))
          ? "button"
          : isTextInput
            ? "textbox"
            : tag === "select"
              ? "combobox"
              : tag === "input" && inputType === "checkbox"
                ? "checkbox"
                : tag === "input" && inputType === "radio"
                  ? "radio"
                  : tag);

    let name = (
      attr(el, "aria-label") ||
      attr(el, "placeholder") ||
      (el as HTMLInputElement).value ||
      attr(el, "title") ||
      attr(el, "alt") ||
      el.textContent ||
      ""
    )
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 80);

    if (!name && tag === "select") {
      const select = el as HTMLSelectElement;
      name = (select.options[select.selectedIndex]?.textContent || "")
        .trim()
        .slice(0, 80);
    }

    const placeholder = attr(el, "placeholder") || undefined;
    const options =
      tag === "select"
        ? Array.from((el as HTMLSelectElement).options)
            .map((o) => (o.textContent || "").trim())
            .filter(Boolean)
            .slice(0, 20)
        : undefined;

    if (!name && !isTextInput && tag !== "select") continue;

    const checked =
      tag === "input" && (inputType === "checkbox" || inputType === "radio")
        ? (el as HTMLInputElement).checked
        : explicitRole === "switch" || explicitRole === "checkbox"
          ? attr(el, "aria-checked") === "true"
          : undefined;

    const expanded = el.hasAttribute("aria-expanded")
      ? attr(el, "aria-expanded") === "true"
      : undefined;

    const id = `${prefix}el_${count}`;
    el.setAttribute("data-jev-id", id);

    const label =
      type === "fill"
        ? `type into ${tag} (${name || placeholder || "input field"})`
        : type === "select"
          ? `select option in (${name || "dropdown"})`
          : type === "check"
            ? `toggle ${name || tag}`
            : `click ${role} "${name}"`;

    out.push({
      id,
      tag,
      type,
      label,
      role,
      name,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      enabled: !disabled,
      checked,
      expanded,
      placeholder,
      options,
    });

    count++;
  }

  return out;
}

export async function collectInteractive(
  page: Page,
  limit = 50,
): Promise<DistilledAction[]> {
  const out: DistilledAction[] = [];
  const frames = page.frames().slice(0, 12);

  for (let f = 0; f < frames.length; f++) {
    const frame = frames[f];
    if (!frame) continue;
    const remaining = limit - out.length;
    if (remaining <= 0) break;
    const prefix = f === 0 ? "" : `f${f}_`;
    try {
      const raw = await frame.evaluate(collectInPage, {
        prefix,
        limit: remaining,
        selector: INTERACTIVE_SELECTOR,
      });
      for (const r of raw) {
        out.push({ ...r, frameIndex: f });
      }
    } catch {
      // cross-origin or detached frame: skip
    }
  }

  return out;
}

function buildInPage(): FrameStructure {
  const headingEls = Array.from(document.querySelectorAll("h1, h2, h3"))
    .slice(0, 15)
    .map((h) => (h.textContent || "").trim().replace(/\s+/g, " ").slice(0, 100))
    .filter(Boolean);

  const landmarks = Array.from(
    document.querySelectorAll(
      "header, nav, main, aside, footer, [role=banner], [role=navigation], [role=main], [role=search], [role=complementary]",
    ),
  )
    .map((l) => attrSafe(l, "aria-label") || l.tagName.toLowerCase())
    .slice(0, 15);

  const dialogs = document.querySelectorAll(
    '[role="dialog"], dialog[open]',
  ).length;

  let scrollables = 0;
  for (const el of Array.from(document.querySelectorAll("*"))) {
    const s = window.getComputedStyle(el);
    if (
      (s.overflowY === "auto" || s.overflowY === "scroll") &&
      el.scrollHeight > el.clientHeight + 20
    ) {
      scrollables++;
    }
  }

  const text = document.body ? document.body.innerText : "";

  return {
    headings: headingEls,
    landmarks,
    dialogs,
    scrollables,
    text,
  };

  function attrSafe(el: Element, name: string): string {
    return el.getAttribute(name) || "";
  }
}

function hashString(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function cap(text: string, budget: number): string {
  if (text.length <= budget) return text;
  return `${text.slice(0, Math.max(0, budget - 3))}...`;
}

export async function buildPerception(
  page: Page,
  opts: PerceptionOptions = {},
): Promise<Perception> {
  const actionLimit = opts.actionLimit ?? 60;
  const textBudget = opts.textBudget ?? 3000;
  const snapshotBudget = opts.snapshotBudget ?? 1500;

  const url = page.url();
  const title = await page.title().catch(() => "");
  const actions = await collectInteractive(page, actionLimit);

  const headings: string[] = [];
  const landmarks: string[] = [];
  const texts: string[] = [];
  let dialogs = 0;
  let scrollables = 0;

  const frames: Frame[] = page.frames();
  const snapshots: string[] = [];
  const frameBudget = Math.min(frames.length, 16);

  for (let f = 0; f < frameBudget; f++) {
    const frame = frames[f];
    if (!frame) continue;
    try {
      const structure = await frame.evaluate(buildInPage);
      headings.push(...structure.headings);
      landmarks.push(...structure.landmarks);
      texts.push(structure.text);
      dialogs += structure.dialogs;
      scrollables += structure.scrollables;
    } catch {
      // cross-origin frame: DOM unavailable
    }
    try {
      const skip = f > 0 && frame.url() === "about:blank";
      if (!skip && snapshots.length < 6) {
        const snapshot =
          f === 0
            ? await page.ariaSnapshot()
            : await frame.locator("body").ariaSnapshot();
        if (snapshot) snapshots.push(`# frame ${f}\n${snapshot}`);
      }
    } catch {
      // aria snapshot unsupported for this frame
    }
  }

  const joinedText = texts
    .join("\n")
    .replace(/\n\s*\n/g, "\n")
    .trim();

  const header = `url: ${url}\ntitle: ${title}\nframes: ${frames.length}`;
  const actionBlockRaw = actions
    .map(
      (a) =>
        `- ${a.id} :: ${a.label}${a.enabled ? "" : " (disabled)"}${a.checked === true ? " (checked)" : ""}${
          a.expanded === true ? " (expanded)" : ""
        }`,
    )
    .join("\n");
  const structureBlockRaw = [
    headings.length ? `headings: ${headings.join(" | ")}` : "",
    landmarks.length ? `landmarks: ${landmarks.join(" | ")}` : "",
    dialogs ? `dialogs: ${dialogs}` : "",
    scrollables ? `scrollable regions: ${scrollables}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const snapshotBlockRaw = snapshots.join("\n\n");
  const textBlockRaw = joinedText;

  const actionBudget = Math.floor(textBudget * 0.4);
  const structureBudget = Math.floor(textBudget * 0.2);
  const snapshotBudgetRest = Math.min(
    snapshotBudget,
    Math.floor(textBudget * 0.2),
  );
  const contentBudget = Math.max(
    0,
    textBudget -
      header.length -
      actionBudget -
      structureBudget -
      snapshotBudgetRest,
  );

  const text = [
    header,
    actionBlockRaw
      ? `actions:\n${cap(actionBlockRaw, actionBudget)}`
      : "actions: none",
    structureBlockRaw
      ? `structure:\n${cap(structureBlockRaw, structureBudget)}`
      : "",
    snapshotBlockRaw
      ? `aria:\n${cap(snapshotBlockRaw, snapshotBudgetRest)}`
      : "",
    textBlockRaw ? `text:\n${cap(textBlockRaw, contentBudget)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const hash = hashString(
    `${url}|${title}|${actionBlockRaw}|${textBlockRaw.length}`,
  );

  return {
    url,
    title,
    text,
    actions,
    headings,
    landmarks,
    dialogs,
    scrollables,
    frames: frames.length,
    hash,
  };
}
