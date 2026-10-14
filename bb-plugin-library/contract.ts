import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { KINDS, LIMITS, TAG_GROUPS } from "./library.js";

export const kindSchema = z.enum(KINDS);
export const tagGroupSchema = z.enum(TAG_GROUPS);
export const idSchema = z.string().regex(/^lib_[a-z0-9]{8}$/, "expected a Library entry id like lib_1a2b3c4d");
export const titleSchema = z.string().trim().min(1).max(LIMITS.title);
export const summarySchema = z.string().trim().max(LIMITS.summary);
export const bodySchema = z.string().trim().min(1).max(LIMITS.body);
export const tagNameSchema = z.string().max(200);

const tagRefSchema = z.object({ tag: z.string(), group: tagGroupSchema });
const tagCountSchema = tagRefSchema.extend({ count: z.number().int().nonnegative() });
export type TagCount = z.infer<typeof tagCountSchema>;
const catalogTagSchema = tagCountSchema.extend({ builtIn: z.boolean() });
export type CatalogTag = z.infer<typeof catalogTagSchema>;

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
  tags: z.array(tagRefSchema),
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
  tags: z.array(tagCountSchema),
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
  tags: z.array(z.object({ tag: tagNameSchema, group: tagGroupSchema }).strict()).max(50),
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
  catalog: {
    input: z.null(),
    output: z.object({ tags: z.array(catalogTagSchema) }),
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
