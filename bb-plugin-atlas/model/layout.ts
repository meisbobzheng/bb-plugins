import ELK, { type ElkExtendedEdge, type ElkNode } from "elkjs/lib/elk.bundled.js";
import type { AtlasNode, Box, Diagram, Layout, Place, Problem } from "../contract.js";
import { keyOf, type DraftDiagram } from "./resolve.js";
import { ASPECT, THUMB } from "./shape.js";

export const MIN_CANVAS = { w: 800, h: 500 } as const;
const PADDING = 48;

const elk = new ELK();

const EDGE_LENGTH = 200;
const NODE_GAP = 36;

const LOGICAL_OPTIONS: Record<string, string> = {
  "elk.algorithm": "stress",
  "elk.stress.desiredEdgeLength": String(EDGE_LENGTH),
};

export function nodeSize(node: AtlasNode): { w: number; h: number } {
  if (node.kind === "system") {
    const w = node.open === null ? 220 : 260;
    return { w, h: THUMB.header + (w - THUMB.inset * 2) / ASPECT + THUMB.footer };
  }
  const text = Math.max(node.label.length * 9.4, node.sub.length * 6.8);
  const extra = node.kind === "store" ? 40 : 0;
  return { w: Math.round(Math.min(300, Math.max(150, text + 40 + extra))), h: node.kind === "ref" ? 60 : 72 };
}

export function labelWidth(label: string): number {
  return label.length * 7.6 + 18;
}

export function fitCanvas(boxes: readonly Box[]): Box {
  if (boxes.length === 0) return { x: 0, y: 0, ...MIN_CANVAS };
  const x0 = Math.min(...boxes.map((b) => b.x)) - PADDING;
  const y0 = Math.min(...boxes.map((b) => b.y)) - PADDING;
  const x1 = Math.max(...boxes.map((b) => b.x + b.w)) + PADDING;
  const y1 = Math.max(...boxes.map((b) => b.y + b.h)) + PADDING;
  let w = Math.max(MIN_CANVAS.w, x1 - x0);
  let h = Math.max(MIN_CANVAS.h, y1 - y0);
  if (w / h > ASPECT) h = w / ASPECT;
  else w = h * ASPECT;
  return { x: (x0 + x1 - w) / 2, y: (y0 + y1 - h) / 2, w, h };
}

function absolute(node: ElkNode, dx: number, dy: number, visit: (node: ElkNode, box: Box, depth: number) => void, depth = 0): void {
  for (const child of node.children ?? []) {
    const box = { x: dx + (child.x ?? 0), y: dy + (child.y ?? 0), w: child.width ?? 0, h: child.height ?? 0 };
    visit(child, box, depth);
    absolute(child, box.x, box.y, visit, depth + 1);
  }
}

function edgesFor(diagram: DraftDiagram, include: (edge: DraftDiagram["edges"][number]) => boolean): ElkExtendedEdge[] {
  return diagram.edges.filter(include).map((edge) => ({
    id: `e:${edge.id}`,
    sources: [`n:${edge.a}`],
    targets: [`n:${edge.b}`],
    labels: [{ text: edge.label, width: labelWidth(edge.label), height: 22 }],
  }));
}

function sized(node: AtlasNode): ElkNode {
  const { w, h } = nodeSize(node);
  return { id: `n:${node.id}`, width: w, height: h };
}

async function logicalLayout(diagram: DraftDiagram, problems: Problem[]): Promise<Layout> {
  const nodes: Record<string, Box> = {};
  const pinned = diagram.nodes.filter(({ id }) => diagram.pins[id] !== undefined);
  if (pinned.length > 0 && pinned.length === diagram.nodes.length) {
    for (const node of diagram.nodes) {
      const [x, y] = diagram.pins[node.id] ?? [0, 0];
      nodes[node.id] = { x, y, ...nodeSize(node) };
    }
    return { canvas: fitCanvas(Object.values(nodes)), nodes, containers: [], trunks: [] };
  }
  if (pinned.length > 0) {
    problems.push({
      severity: "warning",
      file: diagram.file,
      line: null,
      message: `Only ${pinned.length} of ${diagram.nodes.length} nodes have \`at\`, so the pins are ignored. Pin every node or none.`,
    });
  }
  const sizes = new Map(diagram.nodes.map((node) => [node.id, nodeSize(node)]));
  const reach = (id: string) => {
    const size = sizes.get(id) ?? { w: 150, h: 72 };
    return Math.hypot(size.w, size.h) / 2;
  };
  const graph: ElkNode = {
    id: "root",
    layoutOptions: LOGICAL_OPTIONS,
    children: diagram.nodes.map(sized),
    edges: edgesFor(diagram, () => true).map((edge, index) => {
      const source = diagram.edges[index];
      const span = source === undefined ? 0 : reach(source.a) + reach(source.b) + labelWidth(source.label);
      return { ...edge, layoutOptions: { "elk.stress.desiredEdgeLength": String(Math.round(Math.max(EDGE_LENGTH, span + 24))) } };
    }),
  };
  const result = await elk.layout(graph);
  absolute(result, 0, 0, (node, box) => {
    nodes[node.id.slice(2)] = box;
  });
  separate(nodes);
  widen(nodes);
  return { canvas: fitCanvas(Object.values(nodes)), nodes, containers: [], trunks: [] };
}

export function widen(boxes: Record<string, Box>): void {
  const list = Object.values(boxes);
  if (list.length < 2) return;
  const xs = list.map((b) => b.x + b.w / 2);
  const ys = list.map((b) => b.y + b.h / 2);
  if (Math.max(...ys) - Math.min(...ys) <= Math.max(...xs) - Math.min(...xs)) return;
  for (const box of list) {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    box.x = cy - box.w / 2;
    box.y = cx - box.h / 2;
  }
  separate(boxes);
}

export function separate(boxes: Record<string, Box>, gap = NODE_GAP): void {
  const list = Object.values(boxes);
  for (let pass = 0; pass < 200; pass += 1) {
    let moved = false;
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i] as Box;
        const b = list[j] as Box;
        const dx = b.x + b.w / 2 - (a.x + a.w / 2);
        const dy = b.y + b.h / 2 - (a.y + a.h / 2);
        const needX = (a.w + b.w) / 2 + gap - Math.abs(dx);
        const needY = (a.h + b.h) / 2 + gap - Math.abs(dy);
        if (needX <= 0 || needY <= 0) continue;
        moved = true;
        if (needX < needY) {
          const push = (needX / 2) * (dx < 0 ? -1 : 1);
          a.x -= push;
          b.x += push;
        } else {
          const push = (needY / 2) * (dy < 0 ? -1 : 1);
          a.y -= push;
          b.y += push;
        }
      }
    }
    if (!moved) return;
  }
}

interface Item extends Box {
  key: string;
}

const PAD = { left: 18, right: 18, top: 40, bottom: 18 } as const;
const EMPTY_CONTAINER = { w: 180, h: 84 } as const;

function spanBetween(a: Box, b: Box, label: string): number {
  return Math.max(EDGE_LENGTH, Math.hypot(a.w, a.h) / 2 + Math.hypot(b.w, b.h) / 2 + (label === "" ? 0 : labelWidth(label)) + 24);
}

function grid(items: Item[]): void {
  const area = items.reduce((sum, item) => sum + (item.w + NODE_GAP) * (item.h + NODE_GAP), 0);
  const rowWidth = Math.sqrt(area * ASPECT);
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const item of items) {
    if (x > 0 && x + item.w > rowWidth) {
      x = 0;
      y += rowHeight + NODE_GAP;
      rowHeight = 0;
    }
    item.x = x;
    item.y = y;
    x += item.w + NODE_GAP;
    rowHeight = Math.max(rowHeight, item.h);
  }
}

async function arrange(items: Item[], links: ReadonlyArray<readonly [string, string, string]>): Promise<void> {
  if (items.length === 0) return;
  if (links.length === 0) {
    grid(items);
    return;
  }
  const byKey = new Map(items.map((item) => [item.key, item]));
  const result = await elk.layout({
    id: "root",
    layoutOptions: LOGICAL_OPTIONS,
    children: items.map(({ key, w, h }) => ({ id: key, width: w, height: h })),
    edges: links.map(([a, b, label], index) => ({
      id: `l${index}`,
      sources: [a],
      targets: [b],
      layoutOptions: { "elk.stress.desiredEdgeLength": String(Math.round(spanBetween(byKey.get(a) as Item, byKey.get(b) as Item, label))) },
    })),
  });
  for (const child of result.children ?? []) {
    const item = byKey.get(child.id);
    if (item === undefined) continue;
    item.x = child.x ?? 0;
    item.y = child.y ?? 0;
  }
  const boxes = Object.fromEntries(items.map((item) => [item.key, item]));
  separate(boxes);
  widen(boxes);
  const x0 = Math.min(...items.map(({ x }) => x));
  const y0 = Math.min(...items.map(({ y }) => y));
  for (const item of items) {
    item.x -= x0;
    item.y -= y0;
  }
}

async function deploymentLayout(diagram: DraftDiagram, places: Record<string, Place>, used: ReadonlySet<string>, pathEnds: Map<string, [string, string]>): Promise<Layout> {
  const keyToNode = new Map(diagram.nodes.map((node) => [keyOf(diagram.id, node), node.id]));
  const shown = new Set<string>();
  const show = (place: string | null) => {
    for (let at = place; at !== null && places[at] !== undefined; at = places[at]?.parent ?? null) shown.add(at);
  };
  for (const node of diagram.nodes) show(node.place);
  const trunks: Array<{ id: string; a: string; b: string }> = [];
  for (const id of used) {
    const ends = pathEnds.get(id);
    if (ends === undefined) continue;
    const [a, b] = ends.map((end) => (places[end] !== undefined ? (show(end), `p:${end}`) : keyToNode.has(end) ? `n:${keyToNode.get(end)}` : null));
    if (a !== null && b !== null && a !== undefined && b !== undefined) trunks.push({ id, a, b });
  }

  const nodePlace = new Map(diagram.nodes.map((node) => [`n:${node.id}`, node.place !== null && shown.has(node.place) ? node.place : null]));
  const containerOf = (key: string): string | null => {
    if (key.startsWith("n:")) return nodePlace.get(key) ?? null;
    const parent = places[key.slice(2)]?.parent ?? null;
    return parent !== null && shown.has(parent) ? parent : null;
  };
  const liftTo = (key: string, level: string | null): string | null => {
    for (let at: string | null = key, hops = 0; at !== null && hops < 32; hops += 1) {
      const container = containerOf(at);
      if (container === level) return at;
      at = container === null ? null : `p:${container}`;
    }
    return null;
  };
  const links: Array<readonly [string, string, string]> = [
    ...diagram.edges.map((edge) => [`n:${edge.a}`, `n:${edge.b}`, edge.rides.length === 0 ? edge.label : ""] as const),
    ...trunks.map(({ a, b }) => [a, b, ""] as const),
  ];

  const levels = new Map<string | null, Item[]>();
  const build = async (level: string | null): Promise<{ w: number; h: number }> => {
    const items: Item[] = [];
    for (const place of [...shown].sort()) {
      if (containerOf(`p:${place}`) !== level) continue;
      const inner = await build(place);
      const empty = inner.w === 0;
      items.push({ key: `p:${place}`, x: 0, y: 0, w: empty ? EMPTY_CONTAINER.w : inner.w + PAD.left + PAD.right, h: empty ? EMPTY_CONTAINER.h : inner.h + PAD.top + PAD.bottom });
    }
    for (const node of diagram.nodes) {
      if (nodePlace.get(`n:${node.id}`) === level) items.push({ key: `n:${node.id}`, x: 0, y: 0, ...nodeSize(node) });
    }
    const seen = new Set<string>();
    const lifted: Array<readonly [string, string, string]> = [];
    for (const [a, b, label] of links) {
      const x = liftTo(a, level);
      const y = liftTo(b, level);
      const pair = x !== null && y !== null && x < y ? `${x}|${y}` : `${y}|${x}`;
      if (x === null || y === null || x === y || seen.has(pair)) continue;
      seen.add(pair);
      lifted.push([x, y, label]);
    }
    await arrange(items, lifted);
    levels.set(level, items);
    return items.length === 0 ? { w: 0, h: 0 } : { w: Math.max(...items.map((i) => i.x + i.w)), h: Math.max(...items.map((i) => i.y + i.h)) };
  };
  await build(null);

  const nodes: Record<string, Box> = {};
  const containerBoxes = new Map<string, { box: Box; depth: number }>();
  const place = (level: string | null, dx: number, dy: number, depth: number) => {
    for (const item of levels.get(level) ?? []) {
      const box = { x: dx + item.x, y: dy + item.y, w: item.w, h: item.h };
      if (item.key.startsWith("n:")) nodes[item.key.slice(2)] = box;
      else {
        containerBoxes.set(item.key.slice(2), { box, depth });
        place(item.key.slice(2), box.x + PAD.left, box.y + PAD.top, depth + 1);
      }
    }
  };
  place(null, 0, 0, 0);
  const boxOf = (ref: string): Box | undefined => (ref.startsWith("n:") ? nodes[ref.slice(2)] : containerBoxes.get(ref.slice(2))?.box);
  const containers = [...containerBoxes].map(([id, { box, depth }]) => ({ id, depth, box })).sort((x, y) => x.depth - y.depth);
  return {
    canvas: fitCanvas([...Object.values(nodes), ...containers.map(({ box }) => box)]),
    nodes,
    containers,
    trunks: trunks.flatMap(({ id, a, b }) => {
      const boxA = boxOf(a);
      const boxB = boxOf(b);
      return boxA === undefined || boxB === undefined ? [] : [{ id, a: boxA, b: boxB }];
    }),
  };
}

function gridLayout(diagram: DraftDiagram): Layout {
  const nodes: Record<string, Box> = {};
  const columns = Math.max(1, Math.ceil(Math.sqrt(diagram.nodes.length)));
  diagram.nodes.forEach((node, index) => {
    nodes[node.id] = { x: (index % columns) * 320, y: Math.floor(index / columns) * 220, ...nodeSize(node) };
  });
  return { canvas: fitCanvas(Object.values(nodes)), nodes, containers: [], trunks: [] };
}

export async function layoutDiagram(
  diagram: DraftDiagram,
  places: Record<string, Place>,
  pathEnds: Map<string, [string, string]>,
  problems: Problem[],
): Promise<Diagram> {
  const { pins: _pins, ...rest } = diagram;
  const failed = (lens: string, cause: unknown) =>
    problems.push({ severity: "warning", file: diagram.file, line: null, message: `Couldn't lay out the ${lens} view: ${cause instanceof Error ? cause.message : String(cause)}` });
  const logical = await logicalLayout(diagram, problems).catch((cause: unknown) => (failed("logical", cause), gridLayout(diagram)));
  const placed = diagram.nodes.some(({ place }) => place !== null);
  const used = new Set(diagram.edges.flatMap(({ rides }) => rides));
  const deployment = placed
    ? await deploymentLayout(diagram, places, used, pathEnds).catch((cause: unknown) => (failed("deployment", cause), null))
    : null;
  return { ...rest, logical, deployment };
}
