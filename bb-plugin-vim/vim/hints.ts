export const HINT_ALPHABET = "sadfjklewcmpgh";

export function hintLabels(count: number, alphabet: string = HINT_ALPHABET): string[] {
  const labels = [...alphabet];
  let prefixes = 0;
  while (labels.length - prefixes < count) {
    const prefix = labels[prefixes++]!;
    labels.push(...[...alphabet].map((char) => prefix + char));
  }
  return labels.slice(prefixes, prefixes + count);
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
