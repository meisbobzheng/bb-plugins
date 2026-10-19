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

export function matchScore(query: string, fields: readonly string[]): number | null {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
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
