export const HINT_ALPHABET = "sadfjklewcmpgh";

export function hintLabels(count: number, alphabet: string = HINT_ALPHABET): string[] {
  let length = 1;
  while (alphabet.length ** length < count) length += 1;
  return Array.from({ length: Math.max(count, 0) }, (_, index) =>
    Array.from({ length }, (_, digit) => alphabet[Math.floor(index / alphabet.length ** digit) % alphabet.length]).join(""),
  );
}

export interface HintInput {
  typed: string;
  chosen: number | null;
}

export function typeHint(labels: readonly string[], typed: string, char: string): HintInput {
  const next = typed + char.toLowerCase();
  const matches = labels.flatMap((label, index) => (label.startsWith(next) ? [index] : []));
  if (matches.length === 0) return { typed, chosen: null };
  return { typed: next, chosen: matches.length === 1 ? matches[0]! : null };
}
