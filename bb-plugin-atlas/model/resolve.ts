import type { z } from "zod";
import {
  INFRA_FILE,
  ROOT_DIAGRAM,
  type AtlasEdge,
  type AtlasNode,
  type Diagram,
  type EdgePart,
  type Flow,
  type NetworkPath,
  type Place,
  type Plane,
  type Problem,
  type Target,
} from "../contract.js";
import type { IssuePath, SourceFile } from "./load.js";
import {
  CONNECTION,
  LIMITS,
  diagramSource,
  edgeOptions,
  infraSource,
  type DiagramSource,
  type NodeSource,
  type PlaceSource,
} from "./source.js";

export interface DraftDiagram extends Omit<Diagram, "logical" | "deployment"> {
  pins: Record<string, readonly [number, number]>;
}

export interface Resolved {
  root: string | null;
  diagrams: DraftDiagram[];
  places: Record<string, Place>;
  paths: Record<string, NetworkPath>;
  problems: Problem[];
}

interface Working {
  source: SourceFile;
  data: DiagramSource;
  diagram: DraftDiagram;
  edgePaths: Map<string, IssuePath>;
}

const STEP = /^\s*(\S+)\s+->\s+(\S+)\s*$/;
const REF = /^([^#\s]+)#([^#\s]+)$/;
const MAX_LABEL_PARTS = 3;
const MAX_HOPS = 6;

function issuePath(path: IssuePath): string {
  return path.reduce<string>((out, key) => (typeof key === "number" ? `${out}[${key}]` : out === "" ? String(key) : `${out}.${String(key)}`), "");
}

class Report {
  readonly problems: Problem[] = [];

  add(severity: Problem["severity"], source: SourceFile | null, path: IssuePath, message: string): void {
    this.problems.push({ severity, file: source?.file ?? null, line: source?.locate(path) ?? null, message });
  }

  error(source: SourceFile | null, path: IssuePath, message: string): void {
    this.add("error", source, path, message);
  }

  warn(source: SourceFile | null, path: IssuePath, message: string): void {
    this.add("warning", source, path, message);
  }

  issues(source: SourceFile, error: z.ZodError, base: IssuePath = []): void {
    for (const issue of error.issues.slice(0, LIMITS.issuesPerFile)) {
      const path = [...base, ...issue.path];
      this.error(source, path, path.length === 0 ? issue.message : `${issuePath(path)}: ${issue.message}`);
    }
  }
}

export function diagramIdOf(value: string): string {
  return value.trim().replace(/^\.\//, "").replace(/\.ya?ml$/i, "");
}

export function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";
}

function uniqueIn(taken: Set<string>, base: string): string {
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

function joinLabels(labels: readonly string[]): string {
  const shown = labels.slice(0, MAX_LABEL_PARTS).join(" · ");
  return labels.length > MAX_LABEL_PARTS ? `${shown} +${labels.length - MAX_LABEL_PARTS}` : shown;
}

export const keyOf = (diagram: string, node: AtlasNode): string =>
  node.ref === null ? `${diagram}#${node.id}` : `${node.ref.diagram}#${node.ref.node}`;

export function resolveAtlas(files: readonly SourceFile[]): Resolved {
  const report = new Report();
  const places = new Map<string, Place>();
  const working = new Map<string, Working>();
  const nodeSources = new Map<AtlasNode, NodeSource>();
  const infraFile = files.find((file) => file.id === INFRA_FILE) ?? null;
  let rawPaths: Record<string, { label?: string; summary?: string; between: [string, string] }> = {};

  const addPlaces = (record: Record<string, PlaceSource | null>, parent: string | null, path: IssuePath): void => {
    for (const [id, source] of Object.entries(record)) {
      if (places.has(id)) {
        report.error(infraFile, [...path, id], `Place "${id}" is defined twice. Place ids must be unique across infra.yaml.`);
        continue;
      }
      places.set(id, {
        id,
        label: source?.label ?? id,
        kind: source?.kind ?? (parent === null ? "site" : "group"),
        summary: source?.summary ?? "",
        parent,
      });
      if (source?.contains !== undefined) addPlaces(source.contains, id, [...path, id, "contains"]);
    }
  };

  if (infraFile !== null && infraFile.data !== null) {
    const parsed = infraSource.safeParse(infraFile.data);
    if (parsed.success) {
      addPlaces(parsed.data.places ?? {}, null, ["places"]);
      rawPaths = parsed.data.paths ?? {};
    } else {
      report.issues(infraFile, parsed.error);
    }
  }

  for (const source of files) {
    if (source.id === INFRA_FILE || source.data === null) continue;
    const parsed = diagramSource.safeParse(source.data);
    if (!parsed.success) {
      report.issues(source, parsed.error);
      continue;
    }
    const data = parsed.data;
    const pins: Record<string, readonly [number, number]> = {};
    const nodes = Object.entries(data.nodes).map(([id, given]): AtlasNode => {
      const s = given ?? {};
      if (s.ref !== undefined && s.open !== undefined) report.error(source, ["nodes", id], "A node can either `ref` another node or `open` a diagram, not both.");
      if (s.at !== undefined) pins[id] = s.at;
      const node: AtlasNode = {
        id,
        label: s.label ?? id,
        sub: s.sub ?? "",
        kind: s.ref !== undefined ? "ref" : s.open !== undefined ? "system" : (s.kind ?? "service"),
        summary: s.summary ?? "",
        body: s.body ?? "",
        facts: Object.entries(s.facts ?? {}).map(([key, value]) => [key, String(value)]),
        spec: s.spec ?? "",
        open: null,
        ref: null,
        draft: s.ref === undefined && s.open === undefined && s.kind === "system",
        place: null,
        replicas: s.replicas ?? null,
      };
      nodeSources.set(node, s);
      return node;
    });
    working.set(source.id, {
      source,
      data,
      edgePaths: new Map(),
      diagram: {
        id: source.id,
        file: source.file,
        title: data.title,
        summary: data.summary ?? "",
        body: data.body ?? "",
        parent: null,
        nodes,
        edges: [],
        flows: [],
        pins,
      },
    });
  }

  const nodeIn = (diagram: string, node: string): AtlasNode | undefined => working.get(diagram)?.diagram.nodes.find(({ id }) => id === node);
  const sourceOf = (node: AtlasNode): NodeSource => nodeSources.get(node) ?? {};

  for (const w of working.values()) {
    for (const node of w.diagram.nodes) {
      const s = sourceOf(node);
      if (s.open === undefined || s.ref !== undefined) continue;
      const target = diagramIdOf(s.open);
      const child = working.get(target);
      if (child === undefined || target === ROOT_DIAGRAM || target === w.diagram.id) {
        const reason = child === undefined ? `No diagram "${target}".` : `"${target}" can't be opened from here.`;
        report.error(w.source, ["nodes", node.id, "open"], `${reason} \`open\` takes a file path without .yaml, such as epc or epc/hss.`);
        node.draft = true;
        continue;
      }
      if (child.diagram.parent !== null) {
        const { diagram, node: opener } = child.diagram.parent;
        report.warn(w.source, ["nodes", node.id, "open"], `"${target}" is already opened by ${diagram}#${opener}; a diagram has one parent.`);
        continue;
      }
      node.open = target;
      child.diagram.parent = { diagram: w.diagram.id, node: node.id };
    }
  }

  for (const w of working.values()) {
    const seen = new Set<string>([w.diagram.id]);
    let up = w.diagram.parent;
    while (up !== null) {
      if (seen.has(up.diagram)) {
        const opener = working.get(w.diagram.parent?.diagram ?? "");
        report.error(opener?.source ?? null, ["nodes", w.diagram.parent?.node ?? ""], `Opening "${w.diagram.id}" here makes a loop of diagrams.`);
        const node = opener === undefined || w.diagram.parent === null ? undefined : nodeIn(opener.diagram.id, w.diagram.parent.node);
        if (node !== undefined) node.open = null;
        w.diagram.parent = null;
        break;
      }
      seen.add(up.diagram);
      up = working.get(up.diagram)?.diagram.parent ?? null;
    }
  }

  const rawRefs = new Map<AtlasNode, Target>();
  for (const w of working.values()) {
    for (const node of w.diagram.nodes) {
      const value = sourceOf(node).ref;
      if (value === undefined) continue;
      const match = REF.exec(value.trim());
      const target = match === null ? null : { diagram: diagramIdOf(match[1] ?? ""), node: match[2] ?? "" };
      if (target === null || nodeIn(target.diagram, target.node) === undefined) {
        const why = target === null ? `"${value}" isn't a reference. Write diagram#node, such as index#ran or epc#mme.` : `No node "${target.node}" in diagram "${target.diagram}".`;
        report.error(w.source, ["nodes", node.id, "ref"], why);
        node.kind = "external";
        continue;
      }
      rawRefs.set(node, target);
    }
  }

  for (const w of working.values()) {
    for (const node of w.diagram.nodes) {
      let target = rawRefs.get(node);
      if (target === undefined) continue;
      for (let hop = 0; hop < 10; hop += 1) {
        const next = rawRefs.get(nodeIn(target.diagram, target.node) as AtlasNode);
        if (next === undefined) break;
        target = next;
      }
      const end = nodeIn(target.diagram, target.node);
      if (end === undefined || end.kind === "ref") {
        report.error(w.source, ["nodes", node.id, "ref"], "This reference never reaches a real node.");
        node.kind = "external";
        continue;
      }
      const s = sourceOf(node);
      node.ref = target;
      node.label = s.label ?? end.label;
      node.summary = s.summary ?? end.summary;
      node.sub = s.sub ?? `↗ ${working.get(target.diagram)?.diagram.title ?? target.diagram}`;
      node.replicas = s.replicas ?? sourceOf(end).replicas ?? null;
    }
  }

  const noInfra = infraFile === null ? " There is no infra.yaml yet." : "";
  for (const w of working.values()) {
    for (const node of w.diagram.nodes) {
      const given = sourceOf(node)["runs-on"];
      if (given === undefined) continue;
      if (places.has(given)) node.place = given;
      else report.error(w.source, ["nodes", node.id, "runs-on"], `No place "${given}" in infra.yaml.${noInfra}`);
    }
  }
  for (const w of working.values()) {
    for (const node of w.diagram.nodes) {
      if (node.ref !== null && node.place === null) node.place = nodeIn(node.ref.diagram, node.ref.node)?.place ?? null;
    }
  }

  for (const w of working.values()) {
    const ids = new Set(w.diagram.nodes.map(({ id }) => id));
    const taken = new Set<string>();
    (w.data.edges ?? []).forEach((item, index) => {
      const path: IssuePath = ["edges", index];
      const connections = Object.entries(item).filter((entry): entry is [string, string] => typeof entry[1] === "string" && CONNECTION.test(entry[1]));
      const [connection] = connections;
      if (connection === undefined || connections.length > 1) {
        report.error(w.source, path, connections.length > 1 ? "Put one connection per list item." : "Write each connection as `- S6a: mme -- hss` (label: from -- to).");
        return;
      }
      const [label, value] = connection;
      const [, a = "", b = ""] = CONNECTION.exec(value) ?? [];
      const options = edgeOptions.safeParse(Object.fromEntries(Object.entries(item).filter(([key]) => key !== label)));
      if (!options.success) {
        report.issues(w.source, options.error, path);
        return;
      }
      const missing = [a, b].find((end) => !ids.has(end));
      if (missing !== undefined || a === b || label.length > 60) {
        const why = missing !== undefined ? `No node "${missing}" in this diagram.` : a === b ? "A connection needs two different nodes." : "Keep connection labels under 60 characters.";
        report.error(w.source, [...path, label], why);
        return;
      }
      const id = uniqueIn(taken, `${a}~${b}~${slug(label)}`);
      w.edgePaths.set(id, [...path, label]);
      w.diagram.edges.push({
        id,
        a,
        b,
        label,
        plane: options.data.plane ?? "control",
        summary: options.data.summary ?? "",
        spec: options.data.spec ?? "",
        derived: false,
        from: null,
        parts: [],
        rides: [],
      });
    });
  }

  const depthCache = new Map<string, number>();
  const depthOf = (id: string): number => {
    const cached = depthCache.get(id);
    if (cached !== undefined) return cached;
    const parent = working.get(id)?.diagram.parent;
    const depth = parent === null || parent === undefined ? 0 : depthOf(parent.diagram) + 1;
    depthCache.set(id, depth);
    return depth;
  };

  const containersOf = (target: Target): Target[] => {
    const chain: Target[] = [target];
    for (let up = working.get(target.diagram)?.diagram.parent ?? null; up !== null && chain.length < 20; up = working.get(up.diagram)?.diagram.parent ?? null) {
      chain.push(up);
    }
    return chain;
  };

  const mapToParent = (target: Target, parent: DraftDiagram): string | null => {
    for (const candidate of containersOf(target)) {
      if (candidate.diagram === parent.id) return candidate.node;
      const ref = parent.nodes.find((node) => node.ref?.diagram === candidate.diagram && node.ref.node === candidate.node);
      if (ref !== undefined) return ref.id;
    }
    return null;
  };

  const children = [...working.values()]
    .filter(({ diagram }) => diagram.parent !== null)
    .sort((x, y) => depthOf(y.diagram.id) - depthOf(x.diagram.id) || x.diagram.id.localeCompare(y.diagram.id));

  for (const child of children) {
    const { diagram: parentId, node: opener } = child.diagram.parent as Target;
    const parent = working.get(parentId)?.diagram;
    if (parent === undefined) continue;
    const contributions = new Map<string, { refFirst: boolean; labels: string[]; planes: Plane[]; parts: EdgePart[] }>();
    for (const edge of child.diagram.edges) {
      const a = nodeIn(child.diagram.id, edge.a);
      const b = nodeIn(child.diagram.id, edge.b);
      if (a === undefined || b === undefined || (a.ref === null) === (b.ref === null)) continue;
      const [outside, inside, refFirst] = a.ref !== null ? [a, b, true] : [b, a, false];
      const other = mapToParent(outside.ref as Target, parent);
      if (other === null || other === opener) continue;
      const entry = contributions.get(other) ?? { refFirst, labels: [], planes: [], parts: [] };
      contributions.set(other, entry);
      if (!entry.labels.includes(edge.label)) entry.labels.push(edge.label);
      entry.planes.push(edge.plane);
      entry.parts.push(...(edge.parts.length > 0 ? edge.parts : [{ label: edge.label, a: inside.label, b: outside.label, plane: edge.plane }]));
    }
    const taken = new Set(parent.edges.map(({ id }) => id));
    for (const [other, entry] of contributions) {
      const existing = parent.edges.find((edge) => (edge.a === opener && edge.b === other) || (edge.a === other && edge.b === opener));
      if (existing !== undefined) {
        existing.parts.push(...entry.parts);
        if (existing.derived) {
          const labels = [...new Set([...existing.label.split(" · "), ...entry.labels])];
          existing.label = joinLabels(labels);
        }
        continue;
      }
      const [a, b] = entry.refFirst ? [other, opener] : [opener, other];
      parent.edges.push({
        id: uniqueIn(taken, `${a}~${b}~rollup`),
        a,
        b,
        label: joinLabels(entry.labels),
        plane: entry.planes.includes("user") ? "user" : (entry.planes[0] ?? "control"),
        summary: "",
        spec: "",
        derived: true,
        from: child.diagram.id,
        parts: entry.parts,
        rides: [],
      });
    }
  }

  for (const w of working.values()) {
    for (const edge of w.diagram.edges) {
      const seen = new Set<string>();
      edge.parts = edge.parts.filter((part) => {
        const key = `${part.label}|${part.a}|${part.b}`;
        return seen.has(key) ? false : (seen.add(key), true);
      });
    }
  }

  for (const w of working.values()) {
    const ids = new Set(w.diagram.nodes.map(({ id }) => id));
    const taken = new Set<string>();
    for (const [name, steps] of Object.entries(w.data.flows ?? {})) {
      const flow: Flow = { id: uniqueIn(taken, slug(name)), name, steps: [] };
      steps.forEach((step, index) => {
        const path: IssuePath = ["flows", name, index];
        const entries = Object.entries(step);
        const [entry] = entries;
        const match = entry === undefined || entries.length > 1 ? null : STEP.exec(entry[0]);
        if (entry === undefined || match === null) {
          report.error(w.source, path, "Write each step as `- mme -> hss: S6a AIR` (from -> to: what happens).");
          return;
        }
        const [, from = "", to = ""] = match;
        const missing = [from, to].find((end) => !ids.has(end));
        if (missing !== undefined) {
          report.error(w.source, path, `No node "${missing}" in this diagram.`);
          return;
        }
        const edge = w.diagram.edges.find((e) => (e.a === from && e.b === to) || (e.a === to && e.b === from));
        if (edge === undefined) {
          report.warn(w.source, path, `No connection between ${from} and ${to}, so this step is skipped. Add one under edges.`);
          return;
        }
        flow.steps.push({ from, to, text: entry[1], edge: edge.id });
      });
      w.diagram.flows.push(flow);
    }
  }

  const paths = new Map<string, NetworkPath>();
  for (const [id, source] of Object.entries(rawPaths)) {
    const ends = source.between.map((value, index) => {
      if (places.has(value)) return value;
      const match = REF.exec(value.trim());
      const node = match === null ? undefined : nodeIn(diagramIdOf(match[1] ?? ""), match[2] ?? "");
      if (match === null || node === undefined) {
        report.error(infraFile, ["paths", id, "between", index], `"${value}" is neither a place in infra.yaml nor a node like index#ran.`);
        return null;
      }
      return keyOf(diagramIdOf(match[1] ?? ""), node);
    });
    const [x, y] = ends;
    if (x === null || y === null || x === undefined || y === undefined) continue;
    paths.set(id, { id, label: source.label ?? id, summary: source.summary ?? "", between: [x, y] });
  }

  const ancestorsOf = (place: string | null): string[] => {
    const out: string[] = [];
    for (let at = place; at !== null && out.length < 20; at = places.get(at)?.parent ?? null) out.push(at);
    return out;
  };
  const endpoints = new Set([...paths.values()].flatMap(({ between }) => between));

  const route = (from: ReadonlySet<string>, to: ReadonlySet<string>): string[] | null => {
    const queue: Array<{ at: ReadonlySet<string>; via: string[] }> = [{ at: from, via: [] }];
    const used = new Set<string>();
    while (queue.length > 0) {
      const { at, via } = queue.shift() as { at: ReadonlySet<string>; via: string[] };
      if (via.length >= MAX_HOPS) continue;
      for (const path of paths.values()) {
        if (used.has(path.id)) continue;
        const [x, y] = path.between;
        const next = at.has(x) ? y : at.has(y) ? x : null;
        if (next === null) continue;
        used.add(path.id);
        const reached = new Set([next, ...(places.has(next) ? ancestorsOf(next) : [])]);
        const hops = [...via, path.id];
        if ([...reached].some((place) => to.has(place))) return hops;
        queue.push({ at: reached, via: hops });
      }
    }
    return null;
  };

  const whereLabel = (node: AtlasNode): string => (node.place === null ? "nowhere in infra.yaml" : (places.get(node.place)?.label ?? node.place));

  if (paths.size > 0 || places.size > 0) {
    for (const w of working.values()) {
      for (const edge of w.diagram.edges) {
        const a = nodeIn(w.diagram.id, edge.a);
        const b = nodeIn(w.diagram.id, edge.b);
        if (a === undefined || b === undefined) continue;
        const keyA = keyOf(w.diagram.id, a);
        const keyB = keyOf(w.diagram.id, b);
        const from = new Set([keyA, ...ancestorsOf(a.place)]);
        const to = new Set([keyB, ...ancestorsOf(b.place)]);
        if ([...from].some((place) => to.has(place))) continue;
        const hops = route(from, to);
        if (hops !== null) {
          edge.rides = hops;
          continue;
        }
        const floating = (node: AtlasNode, key: string) => node.place === null && !endpoints.has(key);
        if (floating(a, keyA) || floating(b, keyB) || edge.derived) continue;
        report.warn(
          w.source,
          w.edgePaths.get(edge.id) ?? ["edges"],
          `${edge.label} (${a.label} ↔ ${b.label}) runs from ${whereLabel(a)} to ${whereLabel(b)}, but no path in infra.yaml connects them.`,
        );
      }
    }
  }

  const root = working.has(ROOT_DIAGRAM) ? ROOT_DIAGRAM : ([...working.keys()][0] ?? null);
  if (!working.has(ROOT_DIAGRAM) && !files.some(({ id }) => id === ROOT_DIAGRAM) && files.length > 0) {
    report.error(null, [], "No index.yaml. The atlas opens at index.yaml, so add one with the top-level diagram.");
  }
  for (const w of working.values()) {
    if (w.diagram.id !== root && w.diagram.parent === null) {
      report.warn(w.source, [], `Nothing opens "${w.diagram.id}". Add \`open: ${w.diagram.id}\` to the system node it describes.`);
    }
  }

  return {
    root,
    diagrams: [...working.values()].map(({ diagram }) => diagram),
    places: Object.fromEntries(places),
    paths: Object.fromEntries(paths),
    problems: report.problems,
  };
}
