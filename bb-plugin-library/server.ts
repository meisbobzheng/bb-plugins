import { PluginCliError, cliCommand, defineCli, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  bodySchema,
  idSchema,
  kindSchema,
  rpcContract,
  summarySchema,
  tagsSchema,
  titleSchema,
  type Entry,
  type EntryHit,
  type SearchInput,
} from "./contract.js";
import { CHANGED_CHANNEL, KINDS, KIND_LABELS, LIMITS, MARK_END, MARK_START, guessKind, type Kind } from "./library.js";
import { createStore, type Store } from "./store.js";
import { detectTags } from "./topics.js";

export { rpcContract };

export const SAVE_TOOL = "library_save";
export const SEARCH_TOOL = "library_search";
export const GET_TOOL = "library_get";
const TOOL_RESULTS = 10;
const CLI_RESULTS = 20;

const saveFields = z.object({
  title: titleSchema.describe('Specific, searchable title, e.g. "S6a attach: ULR/ULA between MME and HSS"'),
  kind: kindSchema
    .optional()
    .describe("flow for call, registration, and message flows; diagram; explanation; design; reference; or note. Guessed when omitted"),
  summary: summarySchema.default("").describe("One sentence on what this covers"),
  body: bodySchema.describe(`Self-contained Markdown, up to ${LIMITS.body} characters`),
  tags: tagsSchema.default([]).describe("Extra tags beyond the automatically detected ones"),
});
type SaveFields = z.output<typeof saveFields>;

function plainSnippet(snippet: string): string {
  return snippet.replaceAll(MARK_START, "**").replaceAll(MARK_END, "**").replace(/\s+/g, " ").trim();
}

export function hitLines(hits: readonly EntryHit[], query: string): string[] {
  return hits.flatMap((hit) => [
    [hit.id, hit.kind, hit.title, hit.tags.join(", ") || "-", hit.updatedAt.slice(0, 10)].join("\t"),
    ...(query.trim() === "" ? [] : [`\t${plainSnippet(hit.snippet)}`]),
  ]);
}

export function entryDocument(entry: Entry): string {
  const source =
    entry.source.threadTitle === null
      ? null
      : `Saved from "${entry.source.threadTitle}"${entry.source.threadId === null ? " (thread deleted)" : ` (${entry.source.threadId})`}`;
  return [
    `# ${entry.title}`,
    "",
    `${entry.id} · ${KIND_LABELS[entry.kind].one} · tags: ${entry.tags.join(", ") || "none"}`,
    ...(source === null ? [] : [source]),
    `Created ${entry.createdAt.slice(0, 10)}, updated ${entry.updatedAt.slice(0, 10)}`,
    ...(entry.summary === "" ? [] : ["", entry.summary]),
    "",
    "---",
    "",
    entry.body,
  ].join("\n");
}

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, hint: string, label = "input"): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  throw new PluginCliError(`${issue?.path.join(".") || label}: ${issue?.message ?? "invalid"}`, { code: "invalid_value", hint });
}

export default async function plugin(bb: BbPluginApi) {
  const store: Store = createStore(bb.storage);

  const changed = () => bb.realtime.publish(CHANGED_CHANNEL, {});

  async function threadTitle(threadId: string | null): Promise<string | null> {
    if (threadId === null) return null;
    const thread = await bb.sdk.threads.get({ threadId }).catch(() => null);
    return thread === null ? null : (thread.title ?? thread.titleFallback ?? null);
  }

  async function save(
    fields: { title: string; kind: Kind; summary: string; body: string; tags: readonly string[] },
    threadId: string | null,
    messageId: string | null,
  ): Promise<Entry> {
    const entry = store.create({ ...fields, threadId, messageId, threadTitle: await threadTitle(threadId) });
    changed();
    return entry;
  }

  function saveWithDetectedTags(fields: SaveFields, threadId: string | null): Promise<Entry> {
    const tags = [...fields.tags, ...detectTags(`${fields.title}\n${fields.summary}\n${fields.body}`)];
    return save({ ...fields, kind: fields.kind ?? guessKind(fields.body), tags }, threadId, null);
  }

  function search(input: Partial<SearchInput> & { query: string; limit: number }) {
    return store.search({ kind: null, tags: [], threadId: null, ...input });
  }

  function savedMessage(entry: Entry): string {
    return `Saved ${entry.id} "${entry.title}" to the Library (${KIND_LABELS[entry.kind].one}) with tags: ${entry.tags.join(", ") || "none"}.`;
  }

  bb.rpc.register(rpcContract, {
    search: (input) => store.search(input),
    entry: ({ id }) => store.get(id),
    save: ({ threadId, messageId, ...fields }) => save(fields, threadId, messageId),
    update: ({ id, ...edit }) => {
      const entry = store.update(id, edit);
      if (entry === null) throw new Error(`No Library entry ${id}.`);
      changed();
      return entry;
    },
    remove: ({ id }) => {
      const removed = store.remove(id);
      if (removed) changed();
      return { removed };
    },
  });

  bb.events.on("thread.deleted", ({ thread }) => {
    if (store.forgetThread(thread.id) > 0) changed();
  });

  bb.agents.registerTool({
    name: SAVE_TOOL,
    description:
      "Save a diagram, call or registration flow, explanation, or design doc to the user's Library so they can search and reopen it later. Protocol, interface, procedure, and Diameter command tags are added automatically.",
    instructions: `When the user asks to save, keep, or bookmark something for later, call ${SAVE_TOOL} with a self-contained Markdown body: include the full diagram or explanation, never a pointer to this chat. Write call flows as a \`\`\`mermaid sequenceDiagram block. When the user refers to something they saved earlier, find it with ${SEARCH_TOOL} and read it with ${GET_TOOL}.`,
    presentation: { label: { pending: "Saving to Library", completed: "Saved to Library" } },
    parameters: saveFields,
    async execute(fields, { threadId }) {
      return savedMessage(await saveWithDetectedTags(fields, threadId));
    },
  });

  bb.agents.registerTool({
    name: SEARCH_TOOL,
    description:
      "Full-text search of the user's Library of saved flows, diagrams, explanations, and design docs. Returns ids, titles, tags, and matching excerpts.",
    presentation: { label: { pending: "Searching Library", completed: "Searched Library" } },
    parameters: z.object({
      query: z.string().max(LIMITS.query).describe('Words to match; prefixes match too ("regis" finds "registration"). Empty lists the newest entries'),
      kind: kindSchema.optional(),
      tags: z.array(z.string().max(LIMITS.tag)).max(10).default([]).describe('Only entries with every one of these tags, e.g. ["S6a"]'),
      limit: z.number().int().min(1).max(50).default(TOOL_RESULTS),
    }),
    execute({ query, kind, tags, limit }) {
      const result = search({ query, kind: kind ?? null, tags, limit });
      if (result.total === 0) return "No Library entries match.";
      return [`${result.total} match${result.total === 1 ? "" : "es"} (id, kind, title, tags, updated):`, ...hitLines(result.entries, query)].join("\n");
    },
  });

  bb.agents.registerTool({
    name: GET_TOOL,
    description: "Read one Library entry in full, including its Markdown body.",
    presentation: { label: { pending: "Reading Library entry", completed: "Read Library entry" } },
    parameters: z.object({ id: idSchema }),
    execute({ id }) {
      const entry = store.get(id);
      if (entry === null) return { content: [{ type: "text", text: `No Library entry ${id}.` }], isError: true };
      return entryDocument(entry);
    },
  });

  const json = { json: { type: "boolean", description: "Print the result as JSON" } } as const;
  const output = (asJson: boolean, value: unknown, lines: readonly string[]) => ({
    exitCode: 0,
    stdout: asJson ? `${JSON.stringify(value)}\n` : lines.map((line) => `${line}\n`).join(""),
  });
  const idPositional = [{ name: "id", description: "Library entry id, e.g. lib_1a2b3c4d", required: true }] as const;
  const idHint = "Run `bb library search` to list entry ids.";

  bb.cli.register(
    defineCli({
      name: "library",
      summary: "Save and search flows, diagrams, explanations, and design docs in the Library",
      commands: {
        search: cliCommand({
          summary: "Search saved entries; with no query, list the newest",
          aliases: ["list", "ls", "find"],
          positionals: [{ name: "query", description: "Words to match; prefixes match too", variadic: true }],
          options: {
            ...json,
            kind: { type: "enum", values: KINDS, description: "Only entries of this kind" },
            tag: { type: "string", repeatable: true, split: ",", aliases: ["tags"], description: "Only entries with this tag; repeat for more" },
            limit: { type: "integer", min: 1, max: LIMITS.results, default: CLI_RESULTS, description: `Results to print (max ${LIMITS.results})` },
          },
          run({ positionals, options }) {
            const query = positionals.query.join(" ");
            const result = search({ query, kind: options.kind ?? null, tags: options.tag.slice(0, 10), limit: options.limit });
            return output(options.json, result, result.total === 0 ? ["No Library entries match."] : hitLines(result.entries, query));
          },
        }),
        show: cliCommand({
          summary: "Print one entry in full as Markdown",
          aliases: ["get", "cat"],
          positionals: idPositional,
          options: json,
          run({ positionals, options }) {
            const id = parseOrThrow(idSchema, positionals.id, idHint, "id");
            const entry = store.get(id);
            if (entry === null) throw new PluginCliError(`No Library entry ${id}.`, { code: "not_found", hint: idHint });
            return output(options.json, entry, [entryDocument(entry)]);
          },
        }),
        save: cliCommand({
          summary: "Save Markdown as a new entry; detected protocol and interface tags are added",
          options: {
            ...json,
            title: { type: "string", required: true, description: `Specific, searchable title (max ${LIMITS.title} characters)` },
            body: {
              type: "string",
              required: true,
              description: `Markdown body; pass a file with --body "$(cat flow.md)" (max ${LIMITS.body} characters)`,
            },
            kind: { type: "enum", values: KINDS, description: "Entry kind; guessed from the body when omitted" },
            tag: { type: "string", repeatable: true, split: ",", aliases: ["tags"], description: "Extra tag; repeat for more" },
            summary: { type: "string", description: `One-sentence summary (max ${LIMITS.summary} characters)` },
          },
          async run({ options }, ctx) {
            const fields = parseOrThrow(
              saveFields,
              { title: options.title, kind: options.kind, summary: options.summary, body: options.body, tags: options.tag },
              "See `bb library save --help`.",
            );
            const entry = await saveWithDetectedTags(fields, ctx.threadId ?? null);
            return output(options.json, entry, [savedMessage(entry)]);
          },
        }),
        tags: cliCommand({
          summary: "List tags with entry counts",
          options: json,
          run({ options }) {
            const { tags } = search({ query: "", limit: 1 });
            return output(options.json, tags, tags.length === 0 ? ["No tags yet."] : tags.map(({ tag, count }) => `${count}\t${tag}`));
          },
        }),
        delete: cliCommand({
          summary: "Delete an entry",
          aliases: ["rm", "remove"],
          positionals: idPositional,
          options: json,
          run({ positionals, options }) {
            const id = parseOrThrow(idSchema, positionals.id, idHint, "id");
            if (!store.remove(id)) throw new PluginCliError(`No Library entry ${id}.`, { code: "not_found", hint: idHint });
            changed();
            return output(options.json, { removed: id }, [`Deleted ${id}.`]);
          },
        }),
      },
    }),
  );
}
