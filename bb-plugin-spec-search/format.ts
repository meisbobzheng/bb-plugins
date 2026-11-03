import { citation, specPage } from "./specs.js";
import { MARK_END, MARK_START, type ClauseDocument, type Hit, type Identified, type Job, type Spec } from "./store.js";

export const CLAUSE_CHARS = 40_000;

function marked(snippet: string): string {
  return snippet.replaceAll(MARK_START, "**").replaceAll(MARK_END, "**").replace(/\s+/g, " ").trim();
}

export function hitLines(hits: readonly Hit[]): string[] {
  return hits.flatMap((hit) => [
    `${citation(hit.kind, hit.spec, hit.clause)} ${hit.title} (V${hit.version}, ${hit.match})`,
    ...(hit.snippet === "" ? [] : [`  ${marked(hit.snippet)}`]),
  ]);
}

export function identifiedLines(hits: readonly Identified[]): string[] {
  return hits.flatMap((hit) => [
    `${citation(hit.kind, hit.spec, hit.clause)} ${hit.title} (V${hit.version}): ${Math.round(hit.confidence * 100)}% of the passage matches`,
    `  ${marked(hit.snippet)}`,
  ]);
}

export function specLines(specs: readonly Spec[]): string[] {
  return specs.map((spec) => `${spec.kind} ${spec.spec}\tV${spec.version}\t${spec.clauses} clauses\t${spec.title}`);
}

export function jobLines(jobs: readonly Job[]): string[] {
  return jobs.map((job) => {
    const target = job.kind === "fetch" ? `${job.target} (Rel-${job.release})` : job.target;
    return `${job.id}\t${job.status}\t${job.kind} ${target}${job.note ? `\t${job.note}` : ""}`;
  });
}

export function clauseDocument(document: ClauseDocument): string {
  const { spec } = document;
  const body =
    document.body.length > CLAUSE_CHARS
      ? `${document.body.slice(0, CLAUSE_CHARS)}\n\n[Truncated at ${CLAUSE_CHARS} of ${document.body.length} characters. Read the subclauses one at a time.]`
      : document.body;
  return [
    `# ${citation(spec.kind, spec.spec, document.clause)} ${document.title}`,
    [spec.title, `V${spec.version} (Release ${spec.release})`, specPage(spec.spec)].filter((part) => part !== "").join(" · "),
    ...(document.parent === null ? [] : [`Parent: §${document.parent.clause} ${document.parent.title}`]),
    "",
    body === "" ? "(This clause has no text of its own.)" : body,
    ...(document.children.length === 0 ? [] : ["", "Subclauses:", ...document.children.map((child) => `- §${child.clause} ${child.title}`)]),
  ].join("\n");
}
