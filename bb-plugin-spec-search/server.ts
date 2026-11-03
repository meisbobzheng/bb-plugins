import { resolve } from "node:path";
import { PluginCliError, cliCommand, defineCli, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { CATALOG, CATALOG_SPECS } from "./catalog.js";
import { clauseDocument, hitLines, identifiedLines, jobLines, specLines } from "./format.js";
import { createFtp } from "./ftp.js";
import { createIngest, type Ingest } from "./ingest.js";
import { DEFAULT_RELEASE, normalizeClause, normalizeSpec, parseQuery } from "./specs.js";
import { createStore, type Job, type Store } from "./store.js";

export const SEARCH_TOOL = "spec_search";
export const CLAUSE_TOOL = "spec_clause";
export const IDENTIFY_TOOL = "spec_identify";
export const FETCH_TOOL = "spec_fetch";
const SEEDED_KEY = "seeded";
const TOOL_RESULTS = 8;
const CLI_RESULTS = 15;
const FETCH_WAIT = 120_000;
const JOB_HISTORY = 30 * 24 * 60 * 60_000;

const specSchema = z
  .string()
  .max(40)
  .refine((value) => normalizeSpec(value) !== null, { message: "Not a spec number like 29.228." })
  .describe('Spec number, e.g. "29.228" or "TS 29.272"');
const releaseSchema = z.number().int().min(8).max(30);

type Fetch = typeof globalThis.fetch;

function asSpec(value: string): string {
  return normalizeSpec(value)!;
}

function fail(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

function notIndexed(spec: string): string {
  return `${spec} is not indexed. Call ${FETCH_TOOL} with specs: ["${spec}"] to fetch it from the 3GPP FTP, then search again.`;
}

function searchReply(store: Store, query: string, spec: string | null, limit: number): string {
  const specs = store.listSpecs();
  if (specs.length === 0) return `No specs are indexed yet. Call ${FETCH_TOOL} to fetch them from the 3GPP FTP.`;
  if (query.trim() === "" && spec === null) return [`${specs.length} indexed specs:`, ...specLines(specs)].join("\n");
  const result = store.search({ query, spec, limit });
  if (result.missing !== null) return notIndexed(result.missing);
  if (result.hits.length === 0) return "No clauses match.";
  return [...hitLines(result.hits), "", `Read a clause in full with ${CLAUSE_TOOL}.`].join("\n");
}

function queuedLines(jobs: readonly Job[]): string[] {
  return jobs.map((job) => `Queued ${job.kind === "fetch" ? `${job.target} (Rel-${job.release})` : job.target} as job ${job.id}.`);
}

async function settled(ingest: Ingest, jobs: readonly Job[], signal: AbortSignal): Promise<Job[] | null> {
  try {
    return await Promise.all(jobs.map((job) => ingest.wait(job.id, signal)));
  } catch {
    return null;
  }
}

export function specSearch(options: { fetch?: Fetch } = {}) {
  return async function plugin(bb: BbPluginApi): Promise<void> {
    const store = createStore(bb.storage);
    const ftp = createFtp(options.fetch);
    const ingest = createIngest({ store, ftp, log: bb.log });

    const fetchSpecs = (specs: readonly string[], release: number | null) => specs.map((spec) => ingest.enqueue("fetch", spec, release));

    if ((await bb.storage.kv.get<boolean>(SEEDED_KEY)) !== true) {
      fetchSpecs(CATALOG_SPECS, DEFAULT_RELEASE);
      await bb.storage.kv.set(SEEDED_KEY, true);
    }

    bb.background.service("ingest", { start: (signal) => ingest.run(signal) });
    bb.background.schedule("refresh", "0 6 * * 1", () => {
      for (const spec of store.listSpecs()) if (spec.source === "3gpp") ingest.enqueue("fetch", spec.spec, spec.release);
      store.pruneJobs(Date.now() - JOB_HISTORY);
    });

    bb.agents.registerTool({
      name: SEARCH_TOOL,
      description:
        "Search the full text of indexed 3GPP specifications by clause. A spec and clause such as \"29.228 B.1\" returns that clause and its subclauses first; words search clause titles and text. Returns citations with snippets.",
      instructions: `Use ${SEARCH_TOOL} before quoting or paraphrasing 3GPP specification text, then read the clause with ${CLAUSE_TOOL} and cite it as "TS 29.228 §B.1". To find which spec a pasted passage comes from, use ${IDENTIFY_TOOL}. If a spec is not indexed, fetch it with ${FETCH_TOOL}.`,
      presentation: { label: { pending: "Searching 3GPP specs", completed: "Searched 3GPP specs" } },
      parameters: z.object({
        query: z
          .string()
          .max(500)
          .default("")
          .describe('A spec and clause ("29.228 B.1", "TS 29.272 §7.3.2"), words ("Update-Location-Request ULR-Flags"), or both ("29.272 purge"). Empty lists the indexed specs'),
        spec: specSchema.optional().describe("Only search this spec"),
        limit: z.number().int().min(1).max(30).default(TOOL_RESULTS),
      }),
      execute({ query, spec, limit }) {
        return searchReply(store, query, spec === undefined ? null : asSpec(spec), limit);
      },
    });

    bb.agents.registerTool({
      name: CLAUSE_TOOL,
      description: "Read one clause of an indexed 3GPP specification in full, with its parent and a list of its subclauses.",
      presentation: { label: { pending: "Reading 3GPP clause", completed: "Read 3GPP clause" } },
      parameters: z.object({
        spec: specSchema,
        clause: z.string().min(1).max(40).describe('Clause number, e.g. "B.1", "7.3.2", or "A" for Annex A'),
        deep: z.boolean().default(false).describe("Include the text of every subclause too"),
      }),
      execute({ spec: raw, clause, deep }) {
        const spec = asSpec(raw);
        if (store.getSpec(spec) === null) return fail(notIndexed(spec));
        const document = store.clause(spec, normalizeClause(clause), deep);
        if (document === null) return fail(`${spec} has no clause ${clause}. Call ${SEARCH_TOOL} with query "${spec}" for its contents.`);
        return clauseDocument(document);
      },
    });

    bb.agents.registerTool({
      name: IDENTIFY_TOOL,
      description: "Find which indexed 3GPP spec and clause a passage of text comes from, with the share of the passage that matches each candidate.",
      presentation: { label: { pending: "Finding the source clause", completed: "Found the source clause" } },
      parameters: z.object({
        text: z.string().min(20).max(20_000).describe("The passage, copied as exactly as possible"),
        limit: z.number().int().min(1).max(10).default(3),
      }),
      execute({ text, limit }) {
        const hits = store.identify(text, limit);
        return hits.length === 0 ? "No indexed clause shares wording with that passage." : identifiedLines(hits).join("\n");
      },
    });

    bb.agents.registerTool({
      name: FETCH_TOOL,
      description:
        "Download 3GPP specifications from the official 3GPP FTP (www.3gpp.org) and index them by clause. Waits up to two minutes for them to finish indexing.",
      presentation: { label: { pending: "Fetching 3GPP specs", completed: "Fetched 3GPP specs" } },
      parameters: z.object({
        specs: z.array(specSchema).min(1).max(40),
        release: releaseSchema.default(DEFAULT_RELEASE).describe(`3GPP release, ${DEFAULT_RELEASE} by default`),
      }),
      async execute({ specs, release }, { signal }) {
        const jobs = fetchSpecs(specs.map(asSpec), release);
        const done = await settled(ingest, jobs, AbortSignal.any([signal, AbortSignal.timeout(FETCH_WAIT)]));
        if (done === null) return [...queuedLines(jobs), "Still indexing; search again in a minute."].join("\n");
        const lines = done.map((job) => `${job.status === "done" ? "" : "Failed: "}${job.note ?? job.target}`);
        return done.every((job) => job.status === "failed") ? fail(lines.join("\n")) : lines.join("\n");
      },
    });

    const json = { json: { type: "boolean", description: "Print the result as JSON" } } as const;
    const output = (asJson: boolean, value: unknown, lines: readonly string[]) => ({
      exitCode: 0,
      stdout: asJson ? `${JSON.stringify(value)}\n` : lines.map((line) => `${line}\n`).join(""),
    });
    const listHint = "Run `bb spec list` to see the indexed specs.";
    const parseSpec = (value: string) => {
      const spec = normalizeSpec(value);
      if (spec === null) throw new PluginCliError(`"${value}" is not a spec number like 29.228.`, { code: "invalid_value", hint: listHint });
      return spec;
    };
    const waitFor = async (jobs: readonly Job[], asJson: boolean, signal?: AbortSignal) => {
      const done = await settled(ingest, jobs, signal ?? new AbortController().signal);
      if (done === null) return output(asJson, jobs, [...queuedLines(jobs), "Stopped waiting; indexing continues in the background."]);
      return { ...output(asJson, done, jobLines(done)), exitCode: done.some((job) => job.status === "failed") ? 1 : 0 };
    };
    const wait = { wait: { type: "boolean", description: "Wait until indexing finishes" } } as const;

    bb.cli.register(
      defineCli({
        name: "spec",
        summary: "Fetch, index, and search 3GPP specifications by clause",
        commands: {
          search: cliCommand({
            summary: 'Search clauses: "29.228 B.1" opens that clause; words search titles and text',
            aliases: ["find"],
            positionals: [{ name: "query", description: 'Spec and clause, words, or both, e.g. 29.272 7.3.2 or "purge UE"', required: true, variadic: true }],
            options: {
              ...json,
              spec: { type: "string", description: "Only search this spec" },
              limit: { type: "integer", min: 1, max: 50, default: CLI_RESULTS, description: "Results to print" },
            },
            run({ positionals, options }) {
              const query = positionals.query.join(" ");
              const spec = options.spec === undefined ? null : parseSpec(options.spec);
              const result = store.search({ query, spec, limit: options.limit });
              if (result.missing !== null) {
                throw new PluginCliError(`${result.missing} is not indexed.`, { code: "not_indexed", hint: `Run \`bb spec fetch ${result.missing}\`.` });
              }
              return output(options.json, result, result.hits.length === 0 ? ["No clauses match."] : hitLines(result.hits));
            },
          }),
          show: cliCommand({
            summary: "Print one clause in full, e.g. bb spec show 29.228 B.1; a spec alone prints its contents",
            aliases: ["get", "cat"],
            positionals: [{ name: "ref", description: "Spec and clause, e.g. 29.228 B.1", required: true, variadic: true }],
            options: { ...json, deep: { type: "boolean", description: "Include the text of every subclause" } },
            run({ positionals, options }) {
              const parsed = parseQuery(positionals.ref.join(" "));
              if (parsed.spec === null) {
                throw new PluginCliError("Pass a spec and a clause.", { code: "invalid_value", hint: "For example: bb spec show 29.228 B.1" });
              }
              const spec = store.getSpec(parsed.spec);
              if (spec === null) {
                throw new PluginCliError(`${parsed.spec} is not indexed.`, { code: "not_indexed", hint: `Run \`bb spec fetch ${parsed.spec}\`.` });
              }
              if (parsed.clause === null) {
                const { hits } = store.search({ query: parsed.spec, spec: parsed.spec, limit: 200 });
                return output(options.json, { spec, contents: hits }, [`${spec.kind} ${spec.spec} V${spec.version}: ${spec.title}`, ...hits.map((hit) => `  §${hit.clause} ${hit.title}`)]);
              }
              const document = store.clause(parsed.spec, parsed.clause, options.deep);
              if (document === null) {
                throw new PluginCliError(`${parsed.spec} has no clause ${parsed.clause}.`, { code: "not_found", hint: `Run \`bb spec search ${parsed.spec}\` for its contents.` });
              }
              return output(options.json, document, [clauseDocument(document)]);
            },
          }),
          identify: cliCommand({
            summary: "Find which spec and clause a passage comes from",
            positionals: [{ name: "text", description: "The passage; quote it", required: true, variadic: true }],
            options: { ...json, limit: { type: "integer", min: 1, max: 10, default: 3, description: "Candidates to print" } },
            run({ positionals, options }) {
              const hits = store.identify(positionals.text.join(" "), options.limit);
              return output(options.json, hits, hits.length === 0 ? ["No indexed clause shares wording with that passage."] : identifiedLines(hits));
            },
          }),
          fetch: cliCommand({
            summary: "Download specs from the 3GPP FTP and index them; with no specs, fetch the starter catalog",
            positionals: [{ name: "specs", description: "Spec numbers, e.g. 29.228 29.272", variadic: true }],
            options: {
              ...json,
              ...wait,
              rel: { type: "integer", min: 8, max: 30, default: DEFAULT_RELEASE, description: `3GPP release (default ${DEFAULT_RELEASE})` },
            },
            async run({ positionals, options }, ctx) {
              const specs = positionals.specs.length === 0 ? CATALOG_SPECS : positionals.specs.map(parseSpec);
              const jobs = fetchSpecs(specs, options.rel);
              return options.wait ? waitFor(jobs, options.json, ctx.signal) : output(options.json, jobs, queuedLines(jobs));
            },
          }),
          add: cliCommand({
            summary: "Index local spec files: a 3GPP .zip, .docx, or .doc",
            positionals: [{ name: "paths", description: "Files to index", required: true, variadic: true }],
            options: { ...json, ...wait },
            async run({ positionals, options }, ctx) {
              const jobs = positionals.paths.map((path) => ingest.enqueue("file", resolve(ctx.cwd ?? process.cwd(), path)));
              return options.wait ? waitFor(jobs, options.json, ctx.signal) : output(options.json, jobs, queuedLines(jobs));
            },
          }),
          list: cliCommand({
            summary: "List indexed specs",
            aliases: ["ls"],
            options: json,
            run({ options }) {
              const specs = store.listSpecs();
              return output(options.json, specs, specs.length === 0 ? ["No specs are indexed yet. Run `bb spec fetch`."] : specLines(specs));
            },
          }),
          catalog: cliCommand({
            summary: "Show the starter catalog and which of its specs are indexed",
            options: json,
            run({ options }) {
              const indexed = new Map(store.listSpecs().map((spec) => [spec.spec, spec]));
              const lines = CATALOG.flatMap((group) => [
                group.label,
                ...group.specs.map(({ spec, about }) => `  ${spec}\t${indexed.has(spec) ? `V${indexed.get(spec)!.version}` : "not indexed"}\t${about}`),
              ]);
              return output(options.json, CATALOG, lines);
            },
          }),
          jobs: cliCommand({
            summary: "Show queued, running, and recent fetch and index jobs",
            options: { ...json, limit: { type: "integer", min: 1, max: 200, default: 30, description: "Jobs to print" } },
            run({ options }) {
              const jobs = store.jobs(options.limit);
              return output(options.json, jobs, jobs.length === 0 ? ["No jobs."] : jobLines(jobs));
            },
          }),
          refresh: cliCommand({
            summary: "Check the 3GPP FTP for newer versions of every fetched spec",
            options: { ...json, ...wait },
            async run({ options }, ctx) {
              const jobs = store
                .listSpecs()
                .filter((spec) => spec.source === "3gpp")
                .map((spec) => ingest.enqueue("fetch", spec.spec, spec.release));
              return options.wait ? waitFor(jobs, options.json, ctx.signal) : output(options.json, jobs, queuedLines(jobs));
            },
          }),
          remove: cliCommand({
            summary: "Remove a spec from the index",
            aliases: ["rm"],
            positionals: [{ name: "spec", description: "Spec number, e.g. 29.228", required: true }],
            options: json,
            async run({ positionals, options }) {
              const spec = parseSpec(positionals.spec);
              if (!(await store.remove(spec))) throw new PluginCliError(`${spec} is not indexed.`, { code: "not_found", hint: listHint });
              return output(options.json, { removed: spec }, [`Removed ${spec}.`]);
            },
          }),
        },
      }),
    );
  };
}

export default specSearch();
