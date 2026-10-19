export const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

const NAMED: Record<string, string> = {
  Escape: "<Esc>",
  Enter: "<CR>",
  Backspace: "<BS>",
};

export function keyToken(event: KeyLike): string | null {
  if (event.metaKey || event.altKey) return null;
  if (event.ctrlKey) return event.key.length === 1 ? `<C-${event.key.toLowerCase()}>` : null;
  return NAMED[event.key] ?? (event.key.length === 1 ? event.key : null);
}

export function parseKeys(sequence: string): string[] {
  return sequence.match(/<[^>]+>|./gu) ?? [];
}

const LABELS: Record<string, string> = {
  "<Esc>": "Esc",
  "<CR>": "Enter",
  "<BS>": "Backspace",
};

export function formatKeys(sequence: string): string {
  return parseKeys(sequence)
    .map((token) => LABELS[token] ?? token.replace(/^<C-(.)>$/u, (_, key: string) => `Ctrl+${key.toUpperCase()}`))
    .join("");
}
