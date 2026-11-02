import { z } from "zod";

export const TELECOM_KINDS = ["cmd", "avp", "app", "if", "nf"] as const;
export const TELECOM_LIMIT = 20;

export const telecomHitSchema = z.object({
  id: z.string(),
  kind: z.enum(TELECOM_KINDS),
  title: z.string(),
  name: z.string(),
  code: z.string().nullable(),
  summary: z.string(),
  spec: z.string(),
  flow: z.string().nullable(),
  match: z.string(),
  score: z.number(),
});

export type TelecomHit = z.infer<typeof telecomHitSchema>;

const nfNames = z.array(z.string()).transform((ids) => ids.map((id) => id.replace(/^nf\//, "")).join("/"));

const cliHitSchema = z.object({
  id: z.string(),
  score: z.number(),
  match: z.string(),
  entity: z.object({
    kind: z.enum(TELECOM_KINDS),
    name: z.string(),
    code: z.number().optional(),
    appId: z.number().optional(),
    short: z.string().nullish(),
    fullName: z.string().nullish(),
    description: z.string().nullish(),
    request: z.object({ abbrev: z.string().nullable() }).optional(),
    answer: z.object({ abbrev: z.string().nullable() }).nullish(),
    flow: z.object({ request: z.object({ from: nfNames, to: nfNames }) }).nullish(),
    spec: z.array(z.object({ doc: z.string(), clause: z.string().optional() })),
  }),
});

type CliHit = z.infer<typeof cliHitSchema>;

const SUMMARY_LIMIT = 240;

function firstSentence(text: string): string {
  const end = /[.!?](\s|$)/.exec(text);
  return (end ? text.slice(0, end.index + 1) : text).slice(0, SUMMARY_LIMIT);
}

function title({ kind, name, short, request, answer }: CliHit["entity"]): string {
  if (kind === "app") return short ?? name;
  const abbrevs = kind === "cmd" ? [request?.abbrev, answer?.abbrev].filter((abbrev) => !!abbrev) : [];
  return abbrevs.length > 0 ? abbrevs.join(" / ") : name;
}

export function telecomHit({ id, score, match, entity }: CliHit): TelecomHit {
  const code = entity.code ?? entity.appId;
  const flow = entity.flow?.request;
  return {
    id,
    kind: entity.kind,
    title: title(entity),
    name: entity.fullName ?? entity.name,
    code: code === undefined ? null : String(code),
    summary: firstSentence(entity.description ?? ""),
    spec: entity.spec.map((ref) => (ref.clause ? `${ref.doc} §${ref.clause}` : ref.doc)).join("; "),
    flow: flow === undefined ? null : `${flow.from} → ${flow.to}`,
    match,
    score,
  };
}

export function parseTelecomHits(stdout: string): TelecomHit[] {
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((value) => {
    const hit = cliHitSchema.safeParse(value);
    return hit.success ? [telecomHit(hit.data)] : [];
  });
}

export type TelecomRunner = (args: readonly string[]) => Promise<string>;

export function telecomSearcher(run: TelecomRunner, size = 64) {
  const cache = new Map<string, Promise<TelecomHit[]>>();
  return (query: string, limit: number): Promise<TelecomHit[]> => {
    const key = `${limit}:${query}`;
    const cached = cache.get(key);
    if (cached !== undefined) {
      cache.delete(key);
      cache.set(key, cached);
      return cached;
    }
    const result = run(["telecom-ref", "search", "--json", "--limit", String(limit), "--", query])
      .then(parseTelecomHits)
      .catch(() => {
        cache.delete(key);
        return [];
      });
    cache.set(key, result);
    if (cache.size > size) cache.delete(cache.keys().next().value!);
    return result;
  };
}
