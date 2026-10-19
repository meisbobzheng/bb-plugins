import { parseKeys } from "./keys";

export type Action =
  | "down"
  | "up"
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "halfDown"
  | "halfUp"
  | "open"
  | "openSplit"
  | "hint"
  | "hintCursor"
  | "composer"
  | "search"
  | "leave"
  | "nextThread"
  | "previousThread"
  | "back"
  | "forward"
  | "help";

export type Group = "Move" | "Act" | "Go";

export interface Command {
  action: Action;
  keys: readonly string[];
  macKeys?: readonly string[];
  label: string;
  group: Group;
}

export const COMMANDS: readonly Command[] = [
  { action: "down", keys: ["j"], label: "Next item, or scroll down", group: "Move" },
  { action: "up", keys: ["k"], label: "Previous item, or scroll up", group: "Move" },
  { action: "left", keys: ["h"], label: "Pane or column to the left", group: "Move" },
  { action: "right", keys: ["l"], label: "Pane or column to the right", group: "Move" },
  { action: "top", keys: ["gg"], label: "First item, or the top", group: "Move" },
  { action: "bottom", keys: ["G"], label: "Last item, or the bottom", group: "Move" },
  { action: "halfDown", keys: ["d"], macKeys: ["<C-d>"], label: "Half a page down", group: "Move" },
  { action: "halfUp", keys: ["u"], macKeys: ["<C-u>"], label: "Half a page up", group: "Move" },
  { action: "open", keys: ["<CR>", "o"], label: "Open the item under the cursor", group: "Act" },
  { action: "openSplit", keys: ["O"], label: "Open the thread under the cursor in a split", group: "Act" },
  { action: "hint", keys: ["f"], label: "Click anything on screen by its hint", group: "Act" },
  { action: "hintCursor", keys: ["F"], label: "Move the cursor to anything by its hint", group: "Act" },
  { action: "composer", keys: ["i"], label: "Type in the composer", group: "Act" },
  { action: "search", keys: ["/"], label: "Focus search, or the composer", group: "Act" },
  { action: "leave", keys: ["<Esc>"], macKeys: ["<C-[>"], label: "Leave a text field, or cancel", group: "Act" },
  { action: "nextThread", keys: ["gt", "J"], label: "Next thread in the sidebar", group: "Go" },
  { action: "previousThread", keys: ["gT", "K"], label: "Previous thread in the sidebar", group: "Go" },
  { action: "back", keys: ["H"], label: "Back", group: "Go" },
  { action: "forward", keys: ["L"], label: "Forward", group: "Go" },
  { action: "help", keys: ["?"], label: "Show these keys", group: "Go" },
];

export interface Binding {
  keys: readonly string[];
  action: Action;
}

export function sequencesFor(command: Command, mac: boolean): readonly string[] {
  return mac ? [...command.keys, ...(command.macKeys ?? [])] : command.keys;
}

export function keymapFor(mac: boolean): Binding[] {
  return COMMANDS.flatMap((command) =>
    sequencesFor(command, mac).map((sequence) => ({ keys: parseKeys(sequence), action: command.action })),
  );
}

export type Resolution =
  | { kind: "run"; action: Action }
  | { kind: "pending"; keys: readonly string[] }
  | { kind: "none" };

function startsWith(keys: readonly string[], prefix: readonly string[]): boolean {
  return prefix.every((key, index) => keys[index] === key);
}

function attempt(keymap: readonly Binding[], keys: readonly string[]): Resolution {
  if (keymap.some((binding) => binding.keys.length > keys.length && startsWith(binding.keys, keys))) {
    return { kind: "pending", keys };
  }
  const exact = keymap.find((binding) => binding.keys.length === keys.length && startsWith(binding.keys, keys));
  return exact === undefined ? { kind: "none" } : { kind: "run", action: exact.action };
}

export function resolve(keymap: readonly Binding[], pending: readonly string[], token: string): Resolution {
  const continued = pending.length === 0 ? null : attempt(keymap, [...pending, token]);
  return continued === null || continued.kind === "none" ? attempt(keymap, [token]) : continued;
}
