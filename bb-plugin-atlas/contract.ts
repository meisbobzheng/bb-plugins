import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

import { NODE_KINDS, PLACE_KINDS, PLANES } from "./constants.js";

export * from "./constants.js";

const boxSchema = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
export type Box = z.infer<typeof boxSchema>;

const problemSchema = z.object({
  severity: z.enum(["error", "warning"]),
  file: z.string().nullable(),
  line: z.number().int().nullable(),
  message: z.string(),
});
export type Problem = z.infer<typeof problemSchema>;

const targetSchema = z.object({ diagram: z.string(), node: z.string() });
export type Target = z.infer<typeof targetSchema>;

const nodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  sub: z.string(),
  kind: z.enum(NODE_KINDS),
  summary: z.string(),
  body: z.string(),
  facts: z.array(z.tuple([z.string(), z.string()])),
  spec: z.string(),
  open: z.string().nullable(),
  ref: targetSchema.nullable(),
  draft: z.boolean(),
  place: z.string().nullable(),
  replicas: z.number().int().nullable(),
});
export type AtlasNode = z.infer<typeof nodeSchema>;

const partSchema = z.object({ label: z.string(), a: z.string(), b: z.string(), plane: z.enum(PLANES) });
export type EdgePart = z.infer<typeof partSchema>;

const edgeSchema = z.object({
  id: z.string(),
  a: z.string(),
  b: z.string(),
  label: z.string(),
  plane: z.enum(PLANES),
  summary: z.string(),
  spec: z.string(),
  derived: z.boolean(),
  from: z.string().nullable(),
  parts: z.array(partSchema),
  rides: z.array(z.string()),
});
export type AtlasEdge = z.infer<typeof edgeSchema>;

const stepSchema = z.object({ from: z.string(), to: z.string(), text: z.string(), edge: z.string() });
export type FlowStep = z.infer<typeof stepSchema>;

const flowSchema = z.object({ id: z.string(), name: z.string(), steps: z.array(stepSchema) });
export type Flow = z.infer<typeof flowSchema>;

const layoutSchema = z.object({
  canvas: boxSchema,
  nodes: z.record(z.string(), boxSchema),
  containers: z.array(z.object({ id: z.string(), depth: z.number().int(), box: boxSchema })),
  trunks: z.array(z.object({ id: z.string(), a: boxSchema, b: boxSchema })),
});
export type Layout = z.infer<typeof layoutSchema>;

const diagramSchema = z.object({
  id: z.string(),
  file: z.string(),
  title: z.string(),
  summary: z.string(),
  body: z.string(),
  parent: targetSchema.nullable(),
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
  flows: z.array(flowSchema),
  logical: layoutSchema,
  deployment: layoutSchema.nullable(),
});
export type Diagram = z.infer<typeof diagramSchema>;

const placeSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(PLACE_KINDS),
  summary: z.string(),
  parent: z.string().nullable(),
});
export type Place = z.infer<typeof placeSchema>;

const pathSchema = z.object({
  id: z.string(),
  label: z.string(),
  summary: z.string(),
  between: z.tuple([z.string(), z.string()]),
});
export type NetworkPath = z.infer<typeof pathSchema>;

export const atlasSchema = z.object({
  root: z.string(),
  diagrams: z.record(z.string(), diagramSchema),
  places: z.record(z.string(), placeSchema),
  paths: z.record(z.string(), pathSchema),
});
export type Atlas = z.infer<typeof atlasSchema>;

export const snapshotSchema = z.object({
  status: z.enum(["unconfigured", "missing", "ready"]),
  directory: z.string(),
  atlas: atlasSchema.nullable(),
  problems: z.array(problemSchema),
  loadedAt: z.string().nullable(),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

const directoryInput = z.object({ directory: z.string().trim().min(1).max(1024) }).strict();

export const rpcContract = defineRpcContract({
  snapshot: { input: z.null(), output: snapshotSchema },
  useDirectory: { input: directoryInput, output: snapshotSchema },
  createExample: { input: directoryInput, output: snapshotSchema },
});
