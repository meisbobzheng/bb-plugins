const WORD_BOUNDARY = /[\s\-_/.:@#]/;

function termScore(term: string, text: string): number | null {
  const at = text.indexOf(term);
  if (at === 0) return 100;
  if (at > 0) return WORD_BOUNDARY.test(text[at - 1]!) ? 80 : 60;
  let position = -1;
  let gaps = 0;
  for (const char of term) {
    const next = text.indexOf(char, position + 1);
    if (next < 0) return null;
    if (position >= 0) gaps += next - position - 1;
    position = next;
  }
  return Math.max(1, 40 - gaps);
}

export function queryTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

export function matchScore(query: string, fields: readonly string[]): number | null {
  return matchTerms(queryTerms(query), fields);
}

export function matchRanges(terms: readonly string[], text: string): Array<[number, number]> {
  const lower = text.toLowerCase();
  if (lower.length !== text.length) return [];
  const found = terms
    .flatMap((term): Array<[number, number]> => {
      const at = lower.indexOf(term);
      return at < 0 ? [] : [[at, at + term.length]];
    })
    .sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of found) {
    const last = merged[merged.length - 1];
    if (last !== undefined && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

export function matchTerms(terms: readonly string[], fields: readonly string[]): number | null {
  const texts = fields.map((field) => field.toLowerCase());
  let total = 0;
  for (const term of terms) {
    let best: number | null = null;
    texts.forEach((text, index) => {
      const score = termScore(term, text);
      if (score !== null && (best === null || score - index * 5 > best)) best = score - index * 5;
    });
    if (best === null) return null;
    total += best;
  }
  return total;
}
