import type { Atlas, AtlasEdge, AtlasNode, Box, Diagram } from "../../contract";
import { thumbOf } from "../../model/shape";
import {
  along,
  bezier,
  curveBetween,
  curvePath,
  easeInOut,
  insideThumb,
  length,
  lerp,
  lerpBox,
  segment,
  throughThumb,
  zoomFrame,
  type Curve,
  type Segment,
} from "./geometry";

export type Lens = "logical" | "deployment";
export type StageTarget = { kind: "node" | "edge" | "container" | "trunk"; id: string };

export interface StageEvents {
  hover(target: StageTarget | null, point: { x: number; y: number }): void;
  activate(target: StageTarget): void;
  background(): void;
}

export interface Highlight {
  nodes?: readonly string[];
  edges?: readonly string[];
  trunks?: readonly string[];
  containers?: readonly string[];
  live?: string | null;
}

const SVG = "http://www.w3.org/2000/svg";
const ZOOM_MS = 650;
const JUMP_MS = 280;
const MORPH_MS = 950;
const PULSE_MS = 950;

type Frame = (now: number) => void;
const requestFrame = (callback: Frame): number =>
  typeof requestAnimationFrame === "function" ? requestAnimationFrame(callback) : (setTimeout(() => callback(performance.now()), 16) as unknown as number);
const cancelFrame = (id: number) => (typeof cancelAnimationFrame === "function" ? cancelAnimationFrame(id) : clearTimeout(id));
const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  parent?.appendChild(element);
  return element;
}

function text(parent: Element, attrs: Record<string, string | number>, value: string): SVGTextElement {
  const node = el("text", attrs, parent);
  node.textContent = value;
  return node;
}

function setOpacity(element: SVGElement, opacity: number): void {
  element.style.opacity = String(opacity);
  element.style.pointerEvents = opacity < 0.5 ? "none" : "";
  element.classList.toggle("atlas-gone", opacity < 0.02);
}

const labelWidth = (label: string) => label.length * 7.4 + 18;

interface NodeView {
  node: AtlasNode;
  g: SVGGElement;
  box: Box;
}

interface EdgeView {
  edge: AtlasEdge;
  g: SVGGElement;
  hit: SVGLineElement;
  line: SVGLineElement;
  pill: SVGRectElement;
  label: SVGTextElement;
  dots: SVGCircleElement[];
  segment: Segment;
  opacity: number;
}

interface TrunkView {
  id: string;
  g: SVGGElement;
  curve: Curve;
  dots: Array<{ circle: SVGCircleElement; index: number }>;
}

class Layer {
  readonly root: HTMLDivElement;
  readonly svg: SVGSVGElement;
  readonly nodes = new Map<string, NodeView>();
  readonly edges = new Map<string, EdgeView>();
  readonly trunks = new Map<string, TrunkView>();
  readonly containers = new Map<string, SVGGElement>();
  canvas: Box;
  private applied = -1;

  constructor(
    readonly diagram: Diagram,
    readonly atlas: Atlas,
    private readonly events: StageEvents,
    private readonly host: HTMLElement,
  ) {
    this.root = document.createElement("div");
    this.root.className = "atlas-layer";
    this.svg = el("svg", { class: "atlas-svg", preserveAspectRatio: "xMidYMid meet" });
    this.root.appendChild(this.svg);
    this.canvas = diagram.logical.canvas;
    const background = el("rect", { class: "atlas-bg", x: -1e5, y: -1e5, width: 2e5, height: 2e5 }, this.svg);
    background.addEventListener("click", () => this.events.background());
    const containers = el("g", {}, this.svg);
    const trunks = el("g", {}, this.svg);
    const edges = el("g", {}, this.svg);
    const nodes = el("g", {}, this.svg);
    this.buildContainers(containers);
    this.buildTrunks(trunks);
    for (const edge of diagram.edges) this.buildEdge(edge, edges);
    for (const node of diagram.nodes) this.buildNode(node, nodes);
  }

  private point(event: MouseEvent) {
    const rect = this.host.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private bind(element: SVGElement, target: StageTarget): void {
    element.addEventListener("mouseenter", (event) => this.events.hover(target, this.point(event)));
    element.addEventListener("mousemove", (event) => this.events.hover(target, this.point(event)));
    element.addEventListener("mouseleave", (event) => this.events.hover(null, this.point(event)));
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      this.events.activate(target);
    });
  }

  private buildContainers(parent: SVGGElement): void {
    for (const { id, box } of this.diagram.deployment?.containers ?? []) {
      const place = this.atlas.places[id];
      const g = el("g", { class: `atlas-container atlas-place-${place?.kind ?? "group"}`, "data-id": id }, parent);
      el("rect", { class: "atlas-container-box", x: box.x, y: box.y, width: box.w, height: box.h, rx: place?.kind === "namespace" ? 8 : 12 }, g);
      const title = text(g, { class: "atlas-container-title", x: box.x + 12, y: box.y + 22 }, place?.label ?? id);
      if (place !== undefined && place.kind !== "namespace") {
        text(g, { class: "atlas-container-kind", x: box.x + 20 + (title.textContent?.length ?? 0) * 7.6, y: box.y + 22 }, place.kind);
      }
      this.containers.set(id, g);
      this.bind(g, { kind: "container", id });
    }
  }

  private buildTrunks(parent: SVGGElement): void {
    for (const trunk of this.diagram.deployment?.trunks ?? []) {
      const path = this.atlas.paths[trunk.id];
      const curve = curveBetween(trunk.a, trunk.b);
      const g = el("g", { class: "atlas-trunk", "data-id": trunk.id }, parent);
      el("path", { class: "atlas-trunk-pipe", d: curvePath(curve) }, g);
      el("path", { class: "atlas-trunk-core", d: curvePath(curve) }, g);
      const riders = this.diagram.edges.filter(({ rides }) => rides.includes(trunk.id));
      const dots = riders.map((edge, index) => ({ circle: el("circle", { r: 3, class: `atlas-dot atlas-${edge.plane}` }, g), index }));
      const label = path?.label ?? trunk.id;
      const [x, y] = bezier(curve, 0.5);
      const w = labelWidth(label);
      el("rect", { class: "atlas-pill", x: x - w / 2, y: y - 11, width: w, height: 22, rx: 11 }, g);
      text(g, { class: "atlas-pill-text", x, y: y + 4, "text-anchor": "middle" }, label);
      this.trunks.set(trunk.id, { id: trunk.id, g, curve, dots });
      this.bind(g, { kind: "trunk", id: trunk.id });
    }
  }

  private buildEdge(edge: AtlasEdge, parent: SVGGElement): void {
    const g = el("g", { class: `atlas-edge atlas-${edge.plane}`, "data-id": edge.id }, parent);
    const hit = el("line", { class: "atlas-edge-hit" }, g);
    const line = el("line", { class: "atlas-edge-line" }, g);
    const count = edge.plane === "user" ? 3 : 1;
    const dots = Array.from({ length: count * 2 }, () => el("circle", { r: 2.6, class: `atlas-dot atlas-${edge.plane}` }, g));
    const pill = el("rect", { class: "atlas-pill", width: labelWidth(edge.label), height: 22, rx: 11 }, g);
    const label = text(g, { class: "atlas-pill-text", "text-anchor": "middle" }, edge.label);
    this.edges.set(edge.id, { edge, g, hit, line, pill, label, dots, segment: [[0, 0], [0, 0]], opacity: 1 });
    this.bind(g, { kind: "edge", id: edge.id });
  }

  private buildNode(node: AtlasNode, parent: SVGGElement): void {
    const box = this.diagram.logical.nodes[node.id] ?? { x: 0, y: 0, w: 150, h: 72 };
    const { w, h } = box;
    const g = el("g", { class: `atlas-node atlas-kind-${node.kind}${node.draft ? " atlas-draft" : ""}`, "data-id": node.id }, parent);
    if (node.replicas !== null && node.replicas > 1 && this.diagram.deployment !== null) {
      for (const offset of [8, 4]) el("rect", { class: "atlas-replica", x: offset, y: offset, width: w, height: h, rx: 12 }, g);
    }
    el("rect", { class: "atlas-node-body", x: 0, y: 0, width: w, height: h, rx: 12 }, g);
    if (node.kind === "system") {
      text(g, { class: "atlas-node-label", x: 14, y: 22 }, node.label);
      text(g, { class: "atlas-node-sub", x: 22 + node.label.length * 9.4, y: 22 }, node.sub);
      this.buildThumb(node, g, w);
    } else {
      el("rect", { class: "atlas-node-accent", x: 0, y: 14, width: 4, height: h - 28, rx: 2 }, g);
      text(g, { class: "atlas-node-label", x: 16, y: h / 2 - 3 }, node.label);
      text(g, { class: "atlas-node-sub", x: 16, y: h / 2 + 15 }, node.sub);
      if (node.kind === "store") {
        const cx = w - 26;
        const cy = h / 2;
        el("path", { class: "atlas-cylinder", d: `M${cx - 10},${cy - 9} v18 a10,4 0 0 0 20,0 v-18 a10,4 0 0 0 -20,0 a10,4 0 0 0 20,0` }, g);
      }
    }
    if (node.replicas !== null && node.replicas > 1) text(g, { class: "atlas-node-badge", x: w - 10, y: 18, "text-anchor": "end" }, `×${node.replicas}`);
    this.nodes.set(node.id, { node, g, box });
    this.bind(g, { kind: "node", id: node.id });
  }

  private buildThumb(node: AtlasNode, g: SVGGElement, w: number): void {
    const thumb = thumbOf({ x: 0, y: 0, w, h: 0 });
    el("rect", { class: "atlas-thumb", x: thumb.x, y: thumb.y, width: thumb.w, height: thumb.h, rx: 6 }, g);
    const child = node.open === null ? undefined : this.atlas.diagrams[node.open];
    if (child === undefined) {
      text(g, { class: "atlas-thumb-empty", x: thumb.x + thumb.w / 2, y: thumb.y + thumb.h / 2 - 4, "text-anchor": "middle" }, "Not mapped yet");
      text(g, { class: "atlas-thumb-cta", x: thumb.x + thumb.w / 2, y: thumb.y + thumb.h / 2 + 14, "text-anchor": "middle" }, "✦ Draft with an agent");
      return;
    }
    const canvas = child.logical.canvas;
    const scale = thumb.w / canvas.w;
    const map = (b: Box): Box => ({ x: thumb.x + (b.x - canvas.x) * scale, y: thumb.y + (b.y - canvas.y) * scale, w: b.w * scale, h: b.h * scale });
    const mini = el("g", { class: "atlas-mini" }, g);
    for (const edge of child.edges) {
      const a = child.logical.nodes[edge.a];
      const b = child.logical.nodes[edge.b];
      if (a === undefined || b === undefined) continue;
      const [p, q] = segment(map(a), map(b));
      el("line", { x1: p[0], y1: p[1], x2: q[0], y2: q[1] }, mini);
    }
    for (const childNode of child.nodes) {
      const b = child.logical.nodes[childNode.id];
      if (b === undefined) continue;
      const m = map(b);
      el("rect", { class: childNode.kind === "ref" ? "atlas-mini-ref" : "", x: m.x, y: m.y, width: m.w, height: m.h, rx: 2 }, mini);
    }
    const inside = child.nodes.filter(({ kind }) => kind !== "ref").length;
    text(g, { class: "atlas-thumb-cta", x: w - 12, y: thumb.y + thumb.h + 11, "text-anchor": "end" }, `${inside} inside · open ↘`);
  }

  apply(ex: number): void {
    const deployment = this.diagram.deployment;
    const t = deployment === null ? 0 : ex;
    if (t === this.applied) return;
    this.applied = t;
    this.canvas = deployment === null ? this.diagram.logical.canvas : lerpBox(this.diagram.logical.canvas, deployment.canvas, t);
    this.svg.setAttribute("viewBox", `${this.canvas.x} ${this.canvas.y} ${this.canvas.w} ${this.canvas.h}`);
    for (const view of this.nodes.values()) {
      const logical = this.diagram.logical.nodes[view.node.id] ?? view.box;
      view.box = deployment === null ? logical : lerpBox(logical, deployment.nodes[view.node.id] ?? logical, t);
      view.g.setAttribute("transform", `translate(${view.box.x} ${view.box.y})`);
      for (const replica of view.g.querySelectorAll<SVGRectElement>(".atlas-replica")) replica.style.opacity = String(t);
    }
    for (const view of this.edges.values()) {
      const a = this.nodes.get(view.edge.a)?.box;
      const b = this.nodes.get(view.edge.b)?.box;
      if (a === undefined || b === undefined) continue;
      view.segment = segment(a, b);
      const [[x1, y1], [x2, y2]] = view.segment;
      for (const line of [view.hit, view.line]) {
        line.setAttribute("x1", String(x1));
        line.setAttribute("y1", String(y1));
        line.setAttribute("x2", String(x2));
        line.setAttribute("y2", String(y2));
      }
      const [mx, my] = along(view.segment, 0.5);
      const w = Number(view.pill.getAttribute("width"));
      view.pill.setAttribute("x", String(mx - w / 2));
      view.pill.setAttribute("y", String(my - 11));
      view.label.setAttribute("x", String(mx));
      view.label.setAttribute("y", String(my + 4));
      view.opacity = view.edge.rides.length > 0 ? 1 - t : 1;
      setOpacity(view.g, view.opacity);
    }
    for (const [id, g] of this.containers) {
      const depth = this.diagram.deployment?.containers.find((c) => c.id === id)?.depth ?? 0;
      setOpacity(g, Math.max(0, Math.min(1, (t - 0.1 - depth * 0.08) * 2)));
    }
    for (const trunk of this.trunks.values()) setOpacity(trunk.g, Math.max(0, (t - 0.5) * 2));
  }

  tick(now: number, live: boolean): void {
    const seconds = now / 1000;
    for (const view of this.edges.values()) {
      const visible = live && view.opacity > 0.02;
      const count = view.dots.length / 2;
      const total = Math.max(length(view.segment), 1);
      const speed = view.edge.plane === "user" ? 80 : 50;
      view.dots.forEach((dot, index) => {
        dot.style.display = visible ? "" : "none";
        if (!visible) return;
        const reverse = index >= count;
        const phase = (index % count) / count + (reverse ? 0.5 / count : 0);
        const u = (seconds * (speed / total) + phase) % 1;
        const [x, y] = along(view.segment, reverse ? 1 - u : u);
        dot.setAttribute("cx", String(x));
        dot.setAttribute("cy", String(y));
      });
    }
    for (const trunk of this.trunks.values()) {
      for (const { circle, index } of trunk.dots) {
        circle.style.display = live ? "" : "none";
        if (!live) continue;
        const u = (seconds * 0.22 + index / Math.max(trunk.dots.length, 1)) % 1;
        const [x, y] = bezier(trunk.curve, index % 2 === 0 ? u : 1 - u);
        circle.setAttribute("cx", String(x));
        circle.setAttribute("cy", String(y));
      }
    }
  }

  highlight(highlight: Highlight | null): void {
    this.svg.classList.toggle("atlas-focus", highlight !== null);
    for (const element of this.svg.querySelectorAll(".atlas-on, .atlas-live")) element.classList.remove("atlas-on", "atlas-live");
    if (highlight === null) return;
    for (const id of highlight.nodes ?? []) this.nodes.get(id)?.g.classList.add("atlas-on");
    for (const id of highlight.edges ?? []) this.edges.get(id)?.g.classList.add("atlas-on");
    for (const id of highlight.trunks ?? []) this.trunks.get(id)?.g.classList.add("atlas-on");
    for (const id of highlight.containers ?? []) this.containers.get(id)?.classList.add("atlas-on");
    if (highlight.live !== undefined && highlight.live !== null) this.edges.get(highlight.live)?.g.classList.add("atlas-live");
  }

  thumbFrame(nodeId: string) {
    const view = this.nodes.get(nodeId);
    return view === undefined ? null : zoomFrame(thumbOf(view.box), this.canvas);
  }
}

type Step = { kind: "in" | "out"; diagram: string; via: string } | { kind: "jump"; diagram: string };

export function routeBetween(atlas: Atlas, from: string, to: string): Step[] {
  const chain = (id: string): string[] => {
    const out = [id];
    for (let up = atlas.diagrams[id]?.parent ?? null; up !== null && out.length < 32; up = atlas.diagrams[up.diagram]?.parent ?? null) out.push(up.diagram);
    return out;
  };
  const up = chain(from);
  const down = chain(to);
  const common = up.find((id) => down.includes(id));
  if (common === undefined) return [{ kind: "jump", diagram: to }];
  const steps: Step[] = [];
  for (const id of up.slice(0, up.indexOf(common))) {
    const parent = atlas.diagrams[id]?.parent;
    if (parent !== null && parent !== undefined) steps.push({ kind: "out", diagram: parent.diagram, via: parent.node });
  }
  for (const id of down.slice(0, down.indexOf(common)).reverse()) {
    const parent = atlas.diagrams[id]?.parent;
    if (parent !== null && parent !== undefined) steps.push({ kind: "in", diagram: id, via: parent.node });
  }
  return steps;
}

export class Stage {
  private layer: Layer | null = null;
  private atlas: Atlas | null = null;
  private ex = 0;
  private morph: { from: number; to: number; start: number } | null = null;
  private live = true;
  private frame = 0;
  private queue: Promise<void> = Promise.resolve();
  private highlighted: Highlight | null = null;
  private target: string | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly events: StageEvents,
  ) {
    const loop: Frame = (now) => {
      this.step(now);
      this.frame = requestFrame(loop);
    };
    this.frame = requestFrame(loop);
  }

  get diagramId(): string | null {
    return this.layer?.diagram.id ?? null;
  }

  private step(now: number): void {
    if (this.morph !== null) {
      const u = Math.min(1, (now - this.morph.start) / MORPH_MS);
      this.ex = lerp(this.morph.from, this.morph.to, easeInOut(u));
      if (u >= 1) this.morph = null;
    }
    if (this.layer === null || (typeof document !== "undefined" && document.hidden)) return;
    this.layer.apply(this.ex);
    this.layer.tick(now, this.live);
  }

  private mount(diagramId: string): Layer | null {
    const diagram = this.atlas?.diagrams[diagramId];
    if (diagram === undefined || this.atlas === null) return null;
    const layer = new Layer(diagram, this.atlas, this.events, this.host);
    layer.apply(this.ex);
    return layer;
  }

  setAtlas(atlas: Atlas): void {
    this.atlas = atlas;
    const current = this.layer;
    if (current === null) return;
    const next = this.mount(atlas.diagrams[current.diagram.id] === undefined ? atlas.root : current.diagram.id);
    if (next === null) return;
    this.host.replaceChild(next.root, current.root);
    this.layer = next;
    next.highlight(this.highlighted);
  }

  show(diagramId: string): Promise<void> {
    this.target = diagramId;
    this.queue = this.queue.then(() => this.travel(diagramId));
    return this.queue;
  }

  private async travel(diagramId: string): Promise<void> {
    if (this.atlas === null || this.target !== diagramId) return;
    const current = this.layer;
    if (current === null) {
      const layer = this.mount(diagramId);
      if (layer === null) return;
      this.host.appendChild(layer.root);
      this.layer = layer;
      return;
    }
    if (current.diagram.id === diagramId) return;
    this.events.hover(null, { x: 0, y: 0 });
    this.host.classList.add("atlas-busy");
    try {
      for (const step of routeBetween(this.atlas, current.diagram.id, diagramId)) {
        if (step.kind === "jump") await this.jump(step.diagram);
        else if (step.kind === "in") await this.zoomIn(step.diagram, step.via);
        else await this.zoomOut(step.diagram, step.via);
      }
    } finally {
      this.host.classList.remove("atlas-busy");
    }
  }

  private animate(layer: Layer, transform: string, opacity: number, fade: readonly [number, number] | null): void {
    layer.root.style.transition = fade === null ? "none" : `transform ${ZOOM_MS}ms cubic-bezier(.65,0,.25,1), opacity ${ZOOM_MS * fade[0]}ms ease ${ZOOM_MS * fade[1]}ms`;
    layer.root.style.transform = transform;
    layer.root.style.opacity = String(opacity);
  }

  private async zoomIn(diagramId: string, via: string): Promise<void> {
    const parent = this.layer;
    const frame = parent?.thumbFrame(via);
    const child = this.mount(diagramId);
    if (parent === null || child === null || frame === null || frame === undefined) return this.jump(diagramId);
    this.animate(child, insideThumb(frame), 0, null);
    this.host.appendChild(child.root);
    void child.root.offsetWidth;
    this.animate(parent, throughThumb(frame), 0, [0.45, 0.35]);
    this.animate(child, "none", 1, [0.5, 0.2]);
    this.layer = child;
    await wait(ZOOM_MS);
    parent.root.remove();
  }

  private async zoomOut(diagramId: string, via: string): Promise<void> {
    const child = this.layer;
    const parent = this.mount(diagramId);
    const frame = parent?.thumbFrame(via);
    if (child === null || parent === null || frame === null || frame === undefined) return this.jump(diagramId);
    this.animate(parent, throughThumb(frame), 0, null);
    this.host.insertBefore(parent.root, child.root);
    void parent.root.offsetWidth;
    this.animate(child, insideThumb(frame), 0, [0.4, 0.1]);
    this.animate(parent, "none", 1, [0.5, 0.15]);
    this.layer = parent;
    await wait(ZOOM_MS);
    child.root.remove();
  }

  private async jump(diagramId: string): Promise<void> {
    const old = this.layer;
    const next = this.mount(diagramId);
    if (next === null) return;
    next.root.style.opacity = "0";
    this.host.appendChild(next.root);
    void next.root.offsetWidth;
    next.root.style.transition = `opacity ${JUMP_MS}ms ease`;
    next.root.style.opacity = "1";
    if (old !== null) {
      old.root.style.transition = `opacity ${JUMP_MS}ms ease`;
      old.root.style.opacity = "0";
    }
    this.layer = next;
    await wait(JUMP_MS);
    old?.root.remove();
  }

  setLens(lens: Lens, animate = true): void {
    const to = lens === "deployment" ? 1 : 0;
    if (!animate) {
      this.morph = null;
      this.ex = to;
      return;
    }
    this.morph = { from: this.ex, to, start: performance.now() };
  }

  setLive(live: boolean): void {
    this.live = live;
  }

  highlight(highlight: Highlight | null): void {
    this.highlighted = highlight;
    this.layer?.highlight(highlight);
  }

  ping(nodeId: string): void {
    const g = this.layer?.nodes.get(nodeId)?.g;
    if (g === undefined) return;
    g.classList.remove("atlas-ping");
    void g.getBoundingClientRect();
    g.classList.add("atlas-ping");
  }

  pulse(edgeId: string, from: string): Promise<void> {
    const layer = this.layer;
    const view = layer?.edges.get(edgeId);
    if (layer === null || view === undefined) return Promise.resolve();
    const reverse = view.edge.a !== from;
    const circle = el("circle", { r: 7, class: `atlas-pulse atlas-${view.edge.plane}` }, layer.svg);
    const start = performance.now();
    return new Promise((done) => {
      const run: Frame = (now) => {
        const u = Math.min(1, (now - start) / PULSE_MS);
        const [x, y] = along(view.segment, reverse ? 1 - easeInOut(u) : easeInOut(u));
        circle.setAttribute("cx", String(x));
        circle.setAttribute("cy", String(y));
        if (u < 1 && this.layer === layer) requestFrame(run);
        else {
          circle.remove();
          done();
        }
      };
      requestFrame(run);
    });
  }

  destroy(): void {
    cancelFrame(this.frame);
    this.layer?.root.remove();
    this.layer = null;
  }
}
