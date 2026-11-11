import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const itemSchema = z.object({
  key: z.string(),
  kind: z.string(),
  name: z.string(),
  version: z.string(),
  extra: z.string(),
});

const appClassSchema = z.enum(["iru", "manual"]);

const profileSchema = z.object({
  excluded: z.array(z.string()),
  classes: z.record(z.string(), appClassSchema),
});

export const jobSchema = z.object({
  id: z.string(),
  kind: z.enum(["generate", "handback"]),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  exitCode: z.number().int().nullable(),
  lines: z.array(z.string()),
  artifact: z.string().nullable(),
});
export type Job = z.infer<typeof jobSchema>;

const handbackSchema = z.object({
  repo: z.string(),
  pushed: z.number().int(),
  sinceMs: z.number(),
});

export const overviewSchema = z.object({
  mode: z.enum(["main", "travel"]),
  runner: z.string(),
  outputDir: z.string(),
  days: z.number().int(),
  profile: profileSchema,
  scan: z.object({ items: z.array(itemSchema), scannedAt: z.string() }).nullable(),
  job: jobSchema.nullable(),
  handback: handbackSchema.nullable(),
  applied: z.array(z.object({ repo: z.string(), seq: z.number().int() })),
});
export type Overview = z.infer<typeof overviewSchema>;

export const rpcContract = defineRpcContract({
  overview: { input: z.null(), output: overviewSchema },
  scan: { input: z.null(), output: z.object({ items: z.array(itemSchema), scannedAt: z.string() }) },
  setIncluded: {
    input: z.object({ keys: z.array(z.string().min(3).max(500)).max(2000), included: z.boolean() }).strict(),
    output: profileSchema,
  },
  setAppClass: {
    input: z.object({ name: z.string().min(1).max(300), appClass: appClassSchema }).strict(),
    output: profileSchema,
  },
  generate: { input: z.null(), output: jobSchema },
  handback: { input: z.object({ dryRun: z.boolean() }).strict(), output: jobSchema },
  cancel: { input: z.null(), output: z.object({ cancelled: z.boolean() }) },
  reveal: { input: z.object({ path: z.string().min(1).max(2000) }).strict(), output: z.object({ ok: z.boolean() }) },
  handbackRepos: { input: z.null(), output: z.object({ repos: z.array(z.string()), error: z.string().nullable() }) },
});
