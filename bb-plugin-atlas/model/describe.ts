import type { Atlas, AtlasEdge, AtlasNode, Diagram, Problem, Snapshot } from "../contract.js";

export const MAX_TEXT = 24_000;

export function bounded(text: string): string {
  return text.length <= MAX_TEXT ? text : `${text.slice(0, MAX_TEXT)}\n… truncated. Ask for one diagram or node at a time.`;
}

export function problemLine({ severity, file, line, message }: Problem): string {
  const where = file === null ? "atlas" : line === null ? file : `${file}:${line}`;
  return `${where}\t${severity}\t${message}`;
}

const nameOf = (diagram: Diagram, id: string): string => diagram.nodes.find((node) => node.id === id)?.label ?? id;

function depthOf(atlas: Atlas, diagram: Diagram): number {
  let depth = 0;
  for (let up = diagram.parent; up !== null && depth < 20; up = atlas.diagrams[up.diagram]?.parent ?? null) depth += 1;
  return depth;
}

export function treeLines(atlas: Atlas): string[] {
  const lines: string[] = [];
  const visit = (id: string, depth: number) => {
    const diagram = atlas.diagrams[id];
    if (diagram === undefined) return;
    lines.push(`${"  ".repeat(depth)}${diagram.id}\t${diagram.title}\t${diagram.file}\t${diagram.nodes.length} nodes, ${diagram.edges.length} connections, ${diagram.flows.length} flows`);
    for (const node of diagram.nodes) if (node.open !== null) visit(node.open, depth + 1);
  };
  visit(atlas.root, 0);
  for (const diagram of Object.values(atlas.diagrams)) {
    if (diagram.id !== atlas.root && diagram.parent === null) lines.push(`(unlinked) ${diagram.id}\t${diagram.title}\t${diagram.file}`);
  }
  return lines;
}

export function statusText(snapshot: Snapshot): string {
  if (snapshot.status === "unconfigured") {
    return "No atlas folder is set. Run `bb atlas init <folder>` to create an example atlas, or `bb atlas use <folder>` to open an existing one.";
  }
  if (snapshot.status === "missing") return `The atlas folder ${snapshot.directory} doesn't exist. Run \`bb atlas init ${snapshot.directory}\` to create it.`;
  const { atlas, problems } = snapshot;
  const errors = problems.filter(({ severity }) => severity === "error").length;
  return [
    `Atlas folder: ${snapshot.directory}`,
    atlas === null ? "No diagrams yet. Add index.yaml." : `Diagrams (id, title, file, contents):`,
    ...(atlas === null ? [] : treeLines(atlas)),
    problems.length === 0 ? "No problems." : `${problems.length} problem${problems.length === 1 ? "" : "s"} (${errors} error${errors === 1 ? "" : "s"}):`,
    ...problems.map(problemLine),
  ].join("\n");
}

function nodeLine(node: AtlasNode, atlas: Atlas): string {
  const extras = [
    node.kind,
    node.open !== null ? `opens ${node.open}` : null,
    node.draft ? "not mapped yet" : null,
    node.ref !== null ? `ref ${node.ref.diagram}#${node.ref.node}` : null,
    node.place !== null ? `runs on ${atlas.places[node.place]?.label ?? node.place}${node.replicas === null ? "" : ` ×${node.replicas}`}` : null,
    node.spec === "" ? null : node.spec,
  ].filter((part): part is string => part !== null);
  return `- ${node.id}: ${node.label}${node.sub === "" ? "" : ` (${node.sub})`} [${extras.join("; ")}]${node.summary === "" ? "" : ` ${node.summary}`}`;
}

function edgeLine(edge: AtlasEdge, diagram: Diagram, atlas: Atlas): string {
  const extras = [
    edge.plane,
    edge.spec === "" ? null : edge.spec,
    edge.derived ? `rolled up from ${edge.from}` : null,
    edge.rides.length === 0 ? null : `rides ${edge.rides.map((id) => atlas.paths[id]?.label ?? id).join(" → ")}`,
  ].filter((part): part is string => part !== null);
  const parts = edge.parts.length === 0 ? "" : ` Includes ${edge.parts.map(({ label, a, b }) => `${label} (${a} ↔ ${b})`).join(", ")}.`;
  return `- ${edge.label}: ${nameOf(diagram, edge.a)} (${edge.a}) ↔ ${nameOf(diagram, edge.b)} (${edge.b}) [${extras.join("; ")}]${edge.summary === "" ? "" : ` ${edge.summary}`}${parts}`;
}

export function diagramText(atlas: Atlas, diagram: Diagram, problems: readonly Problem[]): string {
  const own = problems.filter(({ file }) => file === diagram.file);
  const trail: string[] = [];
  for (let up = diagram.parent; up !== null && trail.length < 20; up = atlas.diagrams[up.diagram]?.parent ?? null) {
    trail.unshift(`${atlas.diagrams[up.diagram]?.title ?? up.diagram} › `);
  }
  return [
    `# ${trail.join("")}${diagram.title}`,
    `Diagram ${diagram.id}, file ${diagram.file}, level ${depthOf(atlas, diagram)}${diagram.parent === null ? "" : `, opened by ${diagram.parent.diagram}#${diagram.parent.node}`}`,
    ...(diagram.summary === "" ? [] : ["", diagram.summary]),
    ...(diagram.body === "" ? [] : ["", diagram.body.trim()]),
    "",
    "## Nodes",
    ...diagram.nodes.map((node) => nodeLine(node, atlas)),
    "",
    "## Connections",
    ...(diagram.edges.length === 0 ? ["None."] : diagram.edges.map((edge) => edgeLine(edge, diagram, atlas))),
    ...(diagram.flows.length === 0
      ? []
      : ["", "## Flows", ...diagram.flows.flatMap((flow) => [`### ${flow.name}`, ...flow.steps.map((step, i) => `${i + 1}. ${step.from} → ${step.to}: ${step.text}`)])]),
    ...(own.length === 0 ? [] : ["", "## Problems in this file", ...own.map(problemLine)]),
  ].join("\n");
}

export function nodeText(atlas: Atlas, diagram: Diagram, node: AtlasNode): string {
  const edges = diagram.edges.filter(({ a, b }) => a === node.id || b === node.id);
  const flows = diagram.flows.filter(({ steps }) => steps.some(({ from, to }) => from === node.id || to === node.id));
  return [
    `# ${node.label}`,
    `Node ${diagram.id}#${node.id} in ${diagram.file}`,
    nodeLine(node, atlas),
    ...(node.body === "" ? [] : ["", node.body.trim()]),
    ...(node.facts.length === 0 ? [] : ["", "## Facts", ...node.facts.map(([key, value]) => `- ${key}: ${value}`)]),
    "",
    "## Connections",
    ...(edges.length === 0 ? ["None."] : edges.map((edge) => edgeLine(edge, diagram, atlas))),
    ...(flows.length === 0 ? [] : ["", `In flows: ${flows.map(({ name }) => name).join(", ")}`]),
  ].join("\n");
}
