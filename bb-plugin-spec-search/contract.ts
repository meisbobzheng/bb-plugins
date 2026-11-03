import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const refSchema = z.object({ clause: z.string(), title: z.string() });

export const hitSchema = z.object({
  spec: z.string(),
  kind: z.string(),
  version: z.string(),
  clause: z.string(),
  title: z.string(),
  snippet: z.string(),
  match: z.enum(["clause", "subclause", "contents", "text"]),
});

export const clauseSchema = z.object({
  spec: z.object({ spec: z.string(), kind: z.string(), title: z.string(), version: z.string(), release: z.number() }),
  clause: z.string(),
  title: z.string(),
  body: z.string(),
  parent: refSchema.nullable(),
  children: z.array(refSchema),
});

export const rpcContract = defineRpcContract({
  search: {
    input: z.object({ query: z.string().max(500), limit: z.number().int().min(1).max(50).default(10) }),
    output: z.object({ hits: z.array(hitSchema), missing: z.string().nullable() }),
  },
  clause: {
    input: z.object({ spec: z.string().max(40), clause: z.string().max(40) }),
    output: z.object({ clause: clauseSchema.nullable() }),
  },
  fetch: {
    input: z.object({ spec: z.string().max(40) }),
    output: z.object({ status: z.enum(["queued", "running", "done", "failed"]), note: z.string().nullable() }),
  },
});
