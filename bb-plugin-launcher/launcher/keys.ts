import type { Shortcut } from "./types";

export const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export function hasMod(event: KeyLike): boolean {
  return IS_MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

export function matchesShortcut(event: KeyLike, shortcut: Shortcut): boolean {
  return (
    event.key.toLowerCase() === shortcut.key.toLowerCase() &&
    hasMod(event) === (shortcut.mod ?? false) &&
    event.shiftKey === (shortcut.shift ?? false) &&
    !event.altKey
  );
}

export const MOD_K: Shortcut = { key: "k", mod: true };
export const MOD_ENTER: Shortcut = { key: "Enter", mod: true };

const KEY_LABELS: Record<string, string> = {
  enter: "↵",
  backspace: "⌫",
  arrowup: "↑",
  arrowdown: "↓",
};

export function shortcutLabel(shortcut: Shortcut): string {
  const key = KEY_LABELS[shortcut.key.toLowerCase()] ?? shortcut.key.toUpperCase();
  const mod = shortcut.mod ? (IS_MAC ? "⌘" : "Ctrl+") : "";
  const shift = shortcut.shift ? (IS_MAC ? "⇧" : "Shift+") : "";
  return `${shift}${mod}${key}`;
}
