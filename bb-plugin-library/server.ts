import { PluginCliError, cliCommand, defineCli, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  bodySchema,
  idSchema,
  kindSchema,
  rpcContract,
  summarySchema,
  tagNameSchema,
  titleSchema,
  type Entry,
  type EntryHit,
  type SearchInput,
} from "./contract.js";
import { cleanTag, detectTags, termFor, type TagDraft } from "./glossary.js";
import {
  ASSIGNABLE_GROUPS,
  CHANGED_CHANNEL,
  KINDS,
  KIND_LABELS,
  LIMITS,
  MARK_END,
  MARK_START,
  TAG_GROUPS,
  TAG_GROUP_INFO,
  groupTags,
  guessKind,
  isTagGroup,
  type Kind,
  type TagRef,
} from "./library.js";
import { createStore, type GroupMode, type Store } from "./store.js";

export { rpcContract };

export const SAVE_TOOL = "library_save";
export const SEARCH_TOOL = "library_search";
export const GET_TOOL = "library_get";
export const UPDATE_TOOL = "library_update";
const TOOL_RESULTS = 10;
const CLI_RESULTS = 20;

type AssignableGroup = (typeof ASSIGNABLE_GROUPS)[number];

const groupedTagsSchema = z
  .object(
    Object.fromEntries(
      ASSIGNABLE_GROUPS.map((group) => [group, z.array(tagNameSchema).max(LIMITS.tags).optional().describe(TAG_GROUP_INFO[group].hint)]),
    ),
  )
  .strict();
const toolTagsSchema = z.union([groupedTagsSchema, z.array(tagNameSchema).max(50)]);
type ToolTags = z.output<typeof toolTagsSchema>;

const TAGS_HELP =
  "Tags by group. Telecom terms (interfaces, procedures, messages, network functions, protocols, domains) are detected from the content and grouped automatically; put every other tag under the group it belongs to. A tag that already has a group keeps it.";

const saveFields = z.object({
  title: titleSchema.describe('Specific, searchable title, e.g. "S6a attach: ULR/ULA between MME and HSS"'),
  kind: kindSchema
    .optional()
    .describe("flow for call, registration, and message flows; diagram; explanation; design; reference; or note. Guessed when omitted"),
  summary: summarySchema.default("").describe("One sentence on what this covers"),
  body: bodySchema.describe(`Self-contained Markdown, up to ${LIMITS.body} characters`),
  tags: toolTagsSchema.default({}).describe(TAGS_HELP),
});

const updateFields = z.object({
  id: idSchema,
  title: titleSchema.optional().describe("New title; omit to keep the current one"),
  kind: kindSchema.optional().describe("New kind; omit to keep the current one"),
  summary: summarySchema.optional().describe("New one-sentence summary; omit to keep the current one"),
  body: bodySchema.optional().describe(`Full replacement Markdown body, up to ${LIMITS.body} characters; omit to keep the current one`),
  tags: toolTagsSchema.optional().describe(`Replaces the entry's tags; detected tags are added back. Omit to keep the current tags. ${TAGS_HELP}`),
});

type SaveInput = Omit<z.output<typeof saveFields>, "tags"> & { tags: TagDraft[] };
type UpdateInput = Omit<z.output<typeof updateFields>, "tags"> & { tags: TagDraft[] | undefined };

function tagDrafts(tags: ToolTags): TagDraft[] {
  if (Array.isArray(tags)) return tags.map((tag) => ({ tag, group: null }));
  return Object.entries(tags).flatMap(([group, names]) => (isTagGroup(group) && names !== undefined ? names.map((tag) => ({ tag, group })) : []));
}

function hasEdit({ id: _id, ...edit }: UpdateInput): boolean {
  return Object.values(edit).some((value) => value !== undefined);
}

export function describeTags(tags: readonly TagRef[]): string {
  return groupTags(tags)
    .map(({ group, tags: members }) => `${TAG_GROUP_INFO[group].label}: ${members.map(({ tag }) => tag).join(", ")}`)
    .join("; ");
}

export function groupNotes(entry: Entry, requested: readonly TagDraft[]): string[] {
  const final = new Map(entry.tags.map((ref) => [ref.tag.toLowerCase(), ref]));
  const kept = requested.flatMap(({ tag, group }) => {
    const ref = final.get((cleanTag(tag) ?? "").toLowerCase());
    if (group === null || ref === undefined || ref.group === group) return [];
    const reason = termFor(ref.tag) === undefined ? "its existing group" : "built in";
    return [`${ref.tag} (${TAG_GROUP_INFO[ref.group].label}, ${reason})`];
  });
  const ungrouped = entry.tags.filter(({ group }) => group === "other").map(({ tag }) => tag);
  return [
    ...(kept.length === 0 ? [] : [`Kept groups: ${[...new Set(kept)].join(", ")}. Move a tag with \`bb library regroup <tag> <group>\`.`]),
    ...(ungrouped.length === 0
      ? []
      : [`Ungrouped: ${ungrouped.join(", ")}. Pass tags under their group, or run \`bb library regroup <tag> <group>\`.`]),
  ];
}

function plainSnippet(snippet: string): string {
  return snippet.replaceAll(MARK_START, "**").replaceAll(MARK_END, "**").replace(/\s+/g, " ").trim();
}

export function hitLines(hits: readonly EntryHit[], query: string): string[] {
  return hits.flatMap((hit) => [
    [hit.id, hit.kind, hit.title, hit.tags.map(({ tag }) => tag).join(", ") || "-", hit.updatedAt.slice(0, 10)].join("\t"),
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
    `${entry.id} · ${KIND_LABELS[entry.kind].one}`,
    `Tags: ${describeTags(entry.tags) || "none"}`,
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

const GROUP_FLAGS = {
  interface: "interfaces",
  procedure: "procedures",
  message: "messages",
  function: "functions",
  protocol: "protocols",
  domain: "domains",
  component: "components",
  tech: "tech",
  topic: "topics",
  status: "status",
  doc: "docs",
} as const satisfies Record<string, AssignableGroup>;
type GroupFlag = keyof typeof GROUP_FLAGS;

function groupFlag(group: AssignableGroup) {
  return {
    type: "string" as const,
    repeatable: true as const,
    split: ",",
    description: `${TAG_GROUP_INFO[group].label} tag; repeat for more. ${TAG_GROUP_INFO[group].hint}`,
  };
}

const tagFlags = {
  tag: {
    type: "string" as const,
    repeatable: true as const,
    split: ",",
    aliases: ["tags"],
    description: "Tag whose group is already known or detected; repeat for more. Use a group flag such as --topic for a new tag",
  },
  ...(Object.fromEntries(Object.entries(GROUP_FLAGS).map(([flag, group]) => [flag, groupFlag(group)])) as Record<GroupFlag, ReturnType<typeof groupFlag>>),
};

function cliTagDrafts(options: { tag: string[] } & Record<GroupFlag, string[]>): TagDraft[] {
  const grouped = (Object.entries(GROUP_FLAGS) as Array<[GroupFlag, AssignableGroup]>).flatMap(([flag, group]) =>
    options[flag].map((tag) => ({ tag, group })),
  );
  return [...options.tag.map((tag) => ({ tag, group: null })), ...grouped];
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
    fields: { title: string; kind: Kind; summary: string; body: string; tags: readonly TagDraft[] },
    source: { threadId: string | null; messageId: string | null },
    mode: GroupMode,
  ): Promise<Entry> {
    const entry = store.create({ ...fields, ...source, threadTitle: await threadTitle(source.threadId) }, mode);
    changed();
    return entry;
  }

  function detected(title: string, summary: string, body: string): TagDraft[] {
    return detectTags(`${title}\n${summary}\n${body}`).map((tag) => ({ tag, group: null }));
  }

  function saveWithDetectedTags(fields: SaveInput, threadId: string | null): Promise<Entry> {
    const tags = [...fields.tags, ...detected(fields.title, fields.summary, fields.body)];
    return save({ ...fields, kind: fields.kind ?? guessKind(fields.body), tags }, { threadId, messageId: null }, "keep");
  }

  function updateWithDetectedTags({ id, ...edit }: UpdateInput): Entry | null {
    const current = store.get(id);
    if (current === null) return null;
    const title = edit.title ?? current.title;
    const summary = edit.summary ?? current.summary;
    const body = edit.body ?? current.body;
    const kept = edit.tags ?? current.tags.map(({ tag }) => ({ tag, group: null }));
    const entry = store.update(id, { title, kind: edit.kind ?? current.kind, summary, body, tags: [...kept, ...detected(title, summary, body)] }, "keep");
    if (entry !== null) changed();
    return entry;
  }

  function search(input: Partial<SearchInput> & { query: string; limit: number }) {
    return store.search({ kind: null, tags: [], threadId: null, ...input });
  }

  function savedMessage(entry: Entry, requested: readonly TagDraft[], verb: "Saved" | "Updated" = "Saved"): string {
    const where = verb === "Saved" ? "to" : "in";
    return [
      `${verb} ${entry.id} "${entry.title}" ${where} the Library (${KIND_LABELS[entry.kind].one}).`,
      `Tags: ${describeTags(entry.tags) || "none"}.`,
      ...groupNotes(entry, requested),
    ].join("\n");
  }

  bb.rpc.register(rpcContract, {
    search: (input) => store.search(input),
    entry: ({ id }) => store.get(id),
    catalog: () => ({ tags: store.catalog() }),
    save: ({ threadId, messageId, ...fields }) => save(fields, { threadId, messageId }, "set"),
    update: ({ id, ...edit }) => {
      const entry = store.update(id, edit, "set");
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
      "Save a diagram, call or registration flow, explanation, or design doc to the user's Library so they can search and reopen it later. Tags are grouped; telecom terms are detected and grouped automatically.",
    instructions: `When the user asks to save, keep, or bookmark something for later, call ${SAVE_TOOL} with a self-contained Markdown body: include the full diagram or explanation, never a pointer to this chat. Write call flows as a \`\`\`mermaid sequenceDiagram block. Pass tags by group, e.g. tags: { components: ["your-service"], tech: ["Postgres"], topics: ["Outbox"], status: ["Not Implemented"], docs: ["Overview"] }; interfaces, procedures, messages, network functions, protocols, and domains are detected from the content. Run \`bb library groups\` for what each group holds. When the user refers to something they saved earlier, find it with ${SEARCH_TOOL} and read it with ${GET_TOOL}. To fix or extend an entry that is already saved, call ${UPDATE_TOOL} with its id; never save a new copy and delete the old one.`,
    presentation: { label: { pending: "Saving to Library", completed: "Saved to Library" } },
    parameters: saveFields,
    async execute(fields, { threadId }) {
      const tags = tagDrafts(fields.tags);
      return savedMessage(await saveWithDetectedTags({ ...fields, tags }, threadId), tags);
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
    name: UPDATE_TOOL,
    description:
      "Change a saved Library entry in place, keeping its id so links and references to it keep working. Omitted fields keep their current values; detected tags are refreshed from the new content.",
    instructions: `When the user asks to fix, extend, or rewrite an entry they already saved, read it with ${GET_TOOL}, then call ${UPDATE_TOOL} with its id and only the fields that change. A new body replaces the whole body, so send the complete Markdown, not a diff. Pass tags by group, as for ${SAVE_TOOL}. Never save a new copy and delete the old one: that changes the id and breaks links to it.`,
    presentation: { label: { pending: "Updating Library entry", completed: "Updated Library entry" } },
    parameters: updateFields,
    execute(fields) {
      const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });
      const input = { ...fields, tags: fields.tags === undefined ? undefined : tagDrafts(fields.tags) };
      if (!hasEdit(input)) return fail("Nothing to change: pass at least one of title, kind, summary, body, or tags.");
      const entry = updateWithDetectedTags(input);
      return entry === null ? fail(`No Library entry ${fields.id}.`) : savedMessage(entry, input.tags ?? [], "Updated");
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
  const groupHint = `Groups: ${TAG_GROUPS.join(", ")}. Run \`bb library groups\` for what each holds.`;

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
          summary: "Save Markdown as a new entry; detected telecom tags are added and grouped",
          options: {
            ...json,
            title: { type: "string", required: true, description: `Specific, searchable title (max ${LIMITS.title} characters)` },
            body: {
              type: "string",
              required: true,
              description: `Markdown body; pass a file with --body "$(cat flow.md)" (max ${LIMITS.body} characters)`,
            },
            kind: { type: "enum", values: KINDS, description: "Entry kind; guessed from the body when omitted" },
            summary: { type: "string", description: `One-sentence summary (max ${LIMITS.summary} characters)` },
            ...tagFlags,
          },
          async run({ options }, ctx) {
            const fields = parseOrThrow(
              saveFields.omit({ tags: true }),
              { title: options.title, kind: options.kind, summary: options.summary, body: options.body },
              "See `bb library save --help`.",
            );
            const tags = cliTagDrafts(options);
            const entry = await saveWithDetectedTags({ ...fields, tags }, ctx.threadId ?? null);
            return output(options.json, entry, [savedMessage(entry, tags)]);
          },
        }),
        update: cliCommand({
          summary: "Change an entry in place, keeping its id; omitted fields keep their current values",
          aliases: ["edit"],
          positionals: idPositional,
          options: {
            ...json,
            title: { type: "string", description: `New title (max ${LIMITS.title} characters)` },
            body: {
              type: "string",
              description: `Full replacement Markdown body; pass a file with --body "$(cat flow.md)" (max ${LIMITS.body} characters)`,
            },
            kind: { type: "enum", values: KINDS, description: "New entry kind" },
            summary: { type: "string", description: `New one-sentence summary (max ${LIMITS.summary} characters)` },
            ...tagFlags,
          },
          run({ positionals, options }) {
            const fields = parseOrThrow(
              updateFields.omit({ tags: true }),
              { id: positionals.id, title: options.title, kind: options.kind, summary: options.summary, body: options.body },
              "See `bb library update --help`.",
            );
            const tags = cliTagDrafts(options);
            const input = { ...fields, tags: tags.length === 0 ? undefined : tags };
            if (!hasEdit(input)) {
              throw new PluginCliError("Nothing to change.", {
                code: "invalid_value",
                hint: "Pass at least one of --title, --body, --kind, --summary, --tag, or a group flag such as --topic.",
              });
            }
            const entry = updateWithDetectedTags(input);
            if (entry === null) throw new PluginCliError(`No Library entry ${fields.id}.`, { code: "not_found", hint: idHint });
            return output(options.json, entry, [savedMessage(entry, tags, "Updated")]);
          },
        }),
        tags: cliCommand({
          summary: "List tags by group with entry counts",
          options: json,
          run({ options }) {
            const tags = store.catalog();
            const lines = groupTags(tags).flatMap(({ group, tags: members }) => [
              TAG_GROUP_INFO[group].label,
              ...members.map(({ tag, count }) => `  ${String(count).padStart(3)}  ${tag}`),
            ]);
            return output(options.json, tags, tags.length === 0 ? ["No tags yet."] : lines);
          },
        }),
        groups: cliCommand({
          summary: "Describe the tag groups and which tags belong in each",
          options: json,
          run({ options }) {
            const groups = TAG_GROUPS.map((group) => ({ group, ...TAG_GROUP_INFO[group] }));
            return output(options.json, groups, groups.map(({ group, label, hint }) => `${group}\t${label}\t${hint}`));
          },
        }),
        regroup: cliCommand({
          summary: "Move a tag to another group everywhere it is used",
          positionals: [
            { name: "tag", description: "Tag to move; quote it when it has spaces", required: true },
            { name: "group", description: `New group: ${TAG_GROUPS.join(", ")}`, required: true },
          ],
          options: json,
          run({ positionals, options }) {
            const tag = cleanTag(positionals.tag);
            if (tag === null) throw new PluginCliError("The tag is empty.", { code: "invalid_value", hint: groupHint });
            if (!isTagGroup(positionals.group)) {
              throw new PluginCliError(`"${positionals.group}" is not a tag group.`, { code: "invalid_value", hint: groupHint });
            }
            const result = store.regroup(tag, positionals.group);
            if (!result.ok) {
              throw new PluginCliError(`${result.tag} is a built-in ${TAG_GROUP_INFO[result.group].label} tag and stays in that group.`, {
                code: "built_in_tag",
                hint: "Only tags outside the built-in telecom glossary can move.",
              });
            }
            changed();
            return output(options.json, result, [`Moved ${result.tag} to ${TAG_GROUP_INFO[result.group].label}.`]);
          },
        }),
        retag: cliCommand({
          summary: "Add newly detected telecom tags to every saved entry; never removes a tag",
          options: { ...json, "dry-run": { type: "boolean", description: "Show what would change without saving it" } },
          run({ options }) {
            const dryRun = options["dry-run"];
            const changes = store.retag(dryRun);
            if (!dryRun && changes.length > 0) changed();
            const verb = dryRun ? "Would update" : "Updated";
            return output(options.json, changes, [
              ...changes.map(({ id, title, added }) => `${id}\t${added.length === 0 ? "respelled" : `+${added.join(", ")}`}\t${title}`),
              `${verb} ${changes.length} entr${changes.length === 1 ? "y" : "ies"}.`,
            ]);
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

