import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { KINDS, LIMITS } from "./library.js";

export const kindSchema = z.enum(KINDS);
export const idSchema = z.string().regex(/^lib_[a-z0-9]{8}$/, "expected a Library entry id like lib_1a2b3c4d");
export const titleSchema = z.string().trim().min(1).max(LIMITS.title);
export const summarySchema = z.string().trim().max(LIMITS.summary);
export const bodySchema = z.string().trim().min(1).max(LIMITS.body);
export const tagsSchema = z.array(z.string().max(200)).max(50);

const sourceSchema = z.object({
  threadId: z.string().nullable(),
  threadTitle: z.string().nullable(),
  messageId: z.string().nullable(),
});

export const entrySchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: kindSchema,
  summary: z.string(),
  body: z.string(),
  tags: z.array(z.string()),
  source: sourceSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Entry = z.infer<typeof entrySchema>;

const hitSchema = entrySchema.omit({ body: true }).extend({ snippet: z.string() });
export type EntryHit = z.infer<typeof hitSchema>;

const searchResultSchema = z.object({
  entries: z.array(hitSchema),
  total: z.number().int().nonnegative(),
  kinds: z.array(z.object({ kind: kindSchema, count: z.number().int().positive() })),
  tags: z.array(z.object({ tag: z.string(), count: z.number().int().positive() })),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const searchInputSchema = z
  .object({
    query: z.string().max(LIMITS.query),
    kind: kindSchema.nullable(),
    tags: z.array(z.string().max(LIMITS.tag)).max(10),
    threadId: z.string().min(1).nullable(),
    limit: z.number().int().min(1).max(LIMITS.results),
  })
  .strict();
export type SearchInput = z.infer<typeof searchInputSchema>;

const editableFields = {
  title: titleSchema,
  kind: kindSchema,
  summary: summarySchema,
  body: bodySchema,
  tags: tagsSchema,
};

export const rpcContract = defineRpcContract({
  search: {
    input: searchInputSchema,
    output: searchResultSchema,
  },
  entry: {
    input: z.object({ id: idSchema }).strict(),
    output: entrySchema.nullable(),
  },
  save: {
    input: z
      .object({ ...editableFields, threadId: z.string().min(1).nullable(), messageId: z.string().min(1).nullable() })
      .strict(),
    output: entrySchema,
  },
  update: {
    input: z.object({ id: idSchema, ...editableFields }).strict(),
    output: entrySchema,
  },
  remove: {
    input: z.object({ id: idSchema }).strict(),
    output: z.object({ removed: z.boolean() }),
  },
});
