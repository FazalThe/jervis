export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ElementActionType =
  | "click"
  | "fill"
  | "select"
  | "hover"
  | "check"
  | "uncheck";

export interface DistilledAction {
  id: string;
  tag: string;
  type: ElementActionType;
  label: string;
  frameIndex: number;
  role: string;
  name: string;
  rect: Rect | null;
  enabled: boolean;
  checked?: boolean;
  expanded?: boolean;
  placeholder?: string;
  options?: string[];
}

export interface Perception {
  url: string;
  title: string;
  text: string;
  actions: DistilledAction[];
  headings: string[];
  landmarks: string[];
  dialogs: number;
  scrollables: number;
  frames: number;
  hash: string;
}

export type Action =
  | { kind: "click"; id: string }
  | { kind: "fill"; id: string; text: string }
  | { kind: "select"; id: string; value: string }
  | { kind: "hover"; id: string }
  | { kind: "check"; id: string }
  | { kind: "uncheck"; id: string }
  | { kind: "clickAt"; x: number; y: number }
  | { kind: "hoverAt"; x: number; y: number }
  | { kind: "type"; text: string; submit?: boolean }
  | { kind: "press"; key: string }
  | { kind: "pressCombo"; keys: string[] }
  | { kind: "holdKey"; key: string; ms: number }
  | { kind: "scrollBy"; dx: number; dy: number }
  | { kind: "scrollToElement"; id: string }
  | { kind: "scrollToTop" }
  | { kind: "scrollToBottom" }
  | { kind: "back" }
  | { kind: "forward" }
  | { kind: "reload" }
  | { kind: "wait"; ms: number };

export interface StepRecord {
  step: number;
  action: string;
  outcome: string;
  url: string;
  hash: string;
  error?: string;
}
