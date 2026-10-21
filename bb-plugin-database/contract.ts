import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const LIMITS = {
  name: 80,
  host: 253,
  identifier: 63,
  sql: 200_000,
  prompt: 4_000,
  maxRows: 5_000,
  historyQuery: 200,
  historyLimit: 500,
} as const;

export const CHANGED_CHANNEL = "database-changed";
export type ChangedKind = "connections" | "history" | "saved";

export const connectionIdSchema = z.string().regex(/^con_[a-z0-9]{8}$/, "expected a connection id like con_1a2b3c4d");
export const savedIdSchema = z.string().regex(/^sq_[a-z0-9]{8}$/, "expected a saved query id like sq_1a2b3c4d");
export const queryIdSchema = z.string().regex(/^qry_[a-z0-9]{8,16}$/, "expected a query id like qry_1a2b3c4d");
export const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(LIMITS.identifier)
  .regex(/^[A-Za-z0-9_$.-]+$/, "letters, digits, underscore, dot, or hyphen");
export const sqlSchema = z.string().max(LIMITS.sql);

export const authSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("rds-iam"), profile: z.string().trim().min(1).max(100), region: z.string().trim().min(1).max(40) }).strict(),
  z.object({ kind: z.literal("password") }).strict(),
]);
export type Auth = z.infer<typeof authSchema>;

export const connectionFieldsSchema = z
  .object({
    name: z.string().trim().min(1).max(LIMITS.name),
    host: z.string().trim().min(1).max(LIMITS.host),
    port: z.number().int().min(1).max(65535),
    database: identifierSchema,
    user: identifierSchema,
    userFollowsDatabase: z.boolean(),
    auth: authSchema,
    ssl: z.boolean(),
  })
  .strict();
export type ConnectionFields = z.infer<typeof connectionFieldsSchema>;

export const connectionSchema = connectionFieldsSchema.extend({
  id: connectionIdSchema,
  allowWrites: z.boolean(),
  hasPassword: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Connection = z.infer<typeof connectionSchema>;

export const connectionInputSchema = connectionFieldsSchema.extend({
  id: connectionIdSchema.optional(),
  password: z.string().max(1000).nullable().optional(),
});
export type ConnectionInput = z.infer<typeof connectionInputSchema>;

export const columnSchema = z.object({ name: z.string(), type: z.string(), typeId: z.number().int() });
export type Column = z.infer<typeof columnSchema>;

export const resultSetSchema = z.object({
  columns: z.array(columnSchema),
  rows: z.array(z.array(z.string().nullable())),
  rowCount: z.number().int().nullable(),
  command: z.string(),
  truncated: z.boolean(),
});
export type ResultSet = z.infer<typeof resultSetSchema>;

export const errorKindSchema = z.enum(["sql", "auth", "connection", "cancelled", "timeout", "refused"]);
export type ErrorKind = z.infer<typeof errorKindSchema>;

export const queryErrorSchema = z.object({
  kind: errorKindSchema,
  message: z.string(),
  code: z.string().nullable(),
  position: z.number().int().nullable(),
  detail: z.string().nullable(),
  hint: z.string().nullable(),
});
export type QueryError = z.infer<typeof queryErrorSchema>;

export const queryRunSchema = z.object({
  id: z.string(),
  results: z.array(resultSetSchema),
  error: queryErrorSchema.nullable(),
  durationMs: z.number(),
  startedAt: z.string(),
  readOnly: z.boolean(),
});
export type QueryRun = z.infer<typeof queryRunSchema>;

export const tableKindSchema = z.enum(["table", "partitioned-table", "view", "materialized-view", "foreign-table"]);
export type TableKind = z.infer<typeof tableKindSchema>;

export const columnInfoSchema = z.object({
  name: z.string(),
  type: z.string(),
  nullable: z.boolean(),
  default: z.string().nullable(),
  primaryKey: z.boolean(),
  comment: z.string().nullable(),
});
export type ColumnInfo = z.infer<typeof columnInfoSchema>;

export const tableInfoSchema = z.object({
  schema: z.string(),
  name: z.string(),
  kind: tableKindSchema,
  estimatedRows: z.number().nullable(),
  comment: z.string().nullable(),
  columns: z.array(columnInfoSchema),
  indexes: z.array(z.object({ name: z.string(), definition: z.string(), unique: z.boolean(), primary: z.boolean() })),
  foreignKeys: z.array(z.object({ name: z.string(), definition: z.string(), refSchema: z.string(), refTable: z.string() })),
});
export type TableInfo = z.infer<typeof tableInfoSchema>;

export const schemaSnapshotSchema = z.object({
  fetchedAt: z.string(),
  serverVersion: z.string(),
  database: z.string(),
  tables: z.array(tableInfoSchema),
});
export type SchemaSnapshot = z.infer<typeof schemaSnapshotSchema>;

export const historySourceSchema = z.enum(["editor", "ask", "agent", "cli"]);
export type HistorySource = z.infer<typeof historySourceSchema>;

export const historyEntrySchema = z.object({
  id: z.number().int(),
  connectionId: z.string().nullable(),
  connectionName: z.string(),
  database: z.string(),
  sql: z.string(),
  source: historySourceSchema,
  prompt: z.string().nullable(),
  startedAt: z.string(),
  durationMs: z.number(),
  rowCount: z.number().int().nullable(),
  error: z.string().nullable(),
});
export type HistoryEntry = z.infer<typeof historyEntrySchema>;

export const savedQuerySchema = z.object({
  id: savedIdSchema,
  connectionId: z.string().nullable(),
  name: z.string(),
  sql: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SavedQuery = z.infer<typeof savedQuerySchema>;

export const askResultSchema = z.object({
  sql: z.string(),
  explanation: z.string(),
  readOnly: z.boolean(),
  run: queryRunSchema.nullable(),
  attempts: z.number().int(),
  costUsd: z.number().nullable(),
  model: z.string(),
});
export type AskResult = z.infer<typeof askResultSchema>;

export const planSchema = z.array(z.record(z.string(), z.unknown()));
export type Plan = z.infer<typeof planSchema>;

export const explainResultSchema = z.object({
  plan: planSchema.nullable(),
  error: queryErrorSchema.nullable(),
  durationMs: z.number(),
});
export type ExplainResult = z.infer<typeof explainResultSchema>;

export const testResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), serverVersion: z.string(), user: z.string(), database: z.string(), latencyMs: z.number() }),
  z.object({ ok: z.literal(false), error: queryErrorSchema }),
]);
export type TestResult = z.infer<typeof testResultSchema>;

export const awsProfileSchema = z.object({
  name: z.string(),
  ssoSession: z.string().nullable(),
  accountId: z.string().nullable(),
  roleName: z.string().nullable(),
  region: z.string().nullable(),
});
export type AwsProfile = z.infer<typeof awsProfileSchema>;

export const statusSchema = z.object({
  claude: z.object({ available: z.boolean(), path: z.string(), model: z.string() }),
  awsProfiles: z.array(awsProfileSchema),
  maxRows: z.number().int(),
});
export type Status = z.infer<typeof statusSchema>;

const connectionRef = z.object({ connectionId: connectionIdSchema });
const nullableConnection = z.object({ connectionId: connectionIdSchema.nullable() });

export const rpcContract = defineRpcContract({
  connections_list: { input: z.null(), output: z.object({ connections: z.array(connectionSchema), activeId: connectionIdSchema.nullable() }) },
  connections_save: { input: connectionInputSchema, output: connectionSchema },
  connections_delete: { input: z.object({ id: connectionIdSchema }), output: z.object({ removed: z.boolean() }) },
  connections_test: { input: connectionInputSchema, output: testResultSchema },
  connections_activate: { input: z.object({ id: connectionIdSchema }), output: z.object({ activeId: connectionIdSchema.nullable() }) },
  connections_set_writes: { input: z.object({ id: connectionIdSchema, allowWrites: z.boolean() }), output: connectionSchema },
  connections_set_database: { input: z.object({ id: connectionIdSchema, database: identifierSchema }), output: connectionSchema },
  databases_list: { input: connectionRef, output: z.object({ databases: z.array(z.string()) }) },
  schema_get: { input: connectionRef.extend({ refresh: z.boolean().default(false) }), output: schemaSnapshotSchema },
  query_run: {
    input: connectionRef.extend({ sql: sqlSchema, maxRows: z.number().int().min(1).max(LIMITS.maxRows).optional(), queryId: queryIdSchema.optional() }),
    output: queryRunSchema,
  },
  query_cancel: { input: z.object({ queryId: z.string() }), output: z.object({ cancelled: z.boolean() }) },
  query_explain: { input: connectionRef.extend({ sql: sqlSchema, analyze: z.boolean() }), output: explainResultSchema },
  ask: {
    input: connectionRef.extend({ prompt: z.string().trim().min(1).max(LIMITS.prompt), currentSql: sqlSchema.nullable(), run: z.boolean().default(true) }),
    output: askResultSchema,
  },
  history_list: {
    input: nullableConnection.extend({ query: z.string().max(LIMITS.historyQuery).default(""), limit: z.number().int().min(1).max(LIMITS.historyLimit).default(100) }),
    output: z.object({ entries: z.array(historyEntrySchema) }),
  },
  history_clear: { input: nullableConnection, output: z.object({ removed: z.number().int() }) },
  saved_list: { input: nullableConnection, output: z.object({ queries: z.array(savedQuerySchema) }) },
  saved_save: {
    input: z.object({ id: savedIdSchema.optional(), connectionId: connectionIdSchema.nullable(), name: z.string().trim().min(1).max(LIMITS.name), sql: sqlSchema }),
    output: savedQuerySchema,
  },
  saved_delete: { input: z.object({ id: savedIdSchema }), output: z.object({ removed: z.boolean() }) },
  status: { input: z.null(), output: statusSchema },
});
