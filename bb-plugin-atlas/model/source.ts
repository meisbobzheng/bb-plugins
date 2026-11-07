import { z } from "zod";
import { PLACE_KINDS, PLANES, type PlaceKind } from "../contract.js";

export const LIMITS = {
  files: 400,
  fileBytes: 1024 * 1024,
  depth: 8,
  label: 80,
  sub: 120,
  summary: 600,
  body: 20_000,
  issuesPerFile: 20,
} as const;

export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
export const CONNECTION = /^\s*(\S+)\s+(?:--|->)\s+(\S+)\s*$/;

const id = z.string().regex(ID_PATTERN, "use letters, digits, dots, dashes, and underscores");
const text = (max: number) => z.string().max(max);
const fact = z.union([z.string(), z.number(), z.boolean()]);

export const nodeSource = z
  .object({
    label: text(LIMITS.label).optional(),
    sub: text(LIMITS.sub).optional(),
    kind: z.enum(["service", "system", "external", "store"]).optional(),
    summary: text(LIMITS.summary).optional(),
    body: text(LIMITS.body).optional(),
    open: z.string().min(1).optional(),
    ref: z.string().min(1).optional(),
    facts: z.record(z.string(), fact).optional(),
    spec: text(200).optional(),
    "runs-on": id.optional(),
    replicas: z.number().int().min(1).max(999).optional(),
    at: z.tuple([z.number(), z.number()]).optional(),
  })
  .strict();
export type NodeSource = z.infer<typeof nodeSource>;

export const edgeOptions = z
  .object({
    plane: z.enum(PLANES).optional(),
    summary: text(LIMITS.summary).optional(),
    spec: text(200).optional(),
  })
  .strict();

export const diagramSource = z
  .object({
    title: z.string().min(1).max(LIMITS.label),
    summary: text(LIMITS.summary).optional(),
    body: text(LIMITS.body).optional(),
    nodes: z.record(id, nodeSource.nullable()),
    edges: z.array(z.record(z.string(), z.unknown())).optional(),
    flows: z.record(z.string(), z.array(z.record(z.string(), z.string()))).optional(),
  })
  .strict();
export type DiagramSource = z.infer<typeof diagramSource>;

const placeFields = {
  label: text(LIMITS.label).optional(),
  kind: z.enum(PLACE_KINDS).optional(),
  summary: text(LIMITS.summary).optional(),
};

export interface PlaceSource {
  label?: string | undefined;
  kind?: PlaceKind | undefined;
  summary?: string | undefined;
  contains?: Record<string, PlaceSource | null> | undefined;
}

export const placeSource: z.ZodType<PlaceSource> = z.lazy(() =>
  z
    .object({ ...placeFields, contains: z.record(id, placeSource.nullable()).optional() })
    .strict(),
);

export const pathSource = z
  .object({
    label: text(LIMITS.label).optional(),
    summary: text(LIMITS.summary).optional(),
    between: z.tuple([z.string().min(1), z.string().min(1)]),
  })
  .strict();

export const infraSource = z
  .object({
    places: z.record(id, placeSource.nullable()).optional(),
    paths: z.record(id, pathSource).optional(),
  })
  .strict();
export type InfraSource = z.infer<typeof infraSource>;
