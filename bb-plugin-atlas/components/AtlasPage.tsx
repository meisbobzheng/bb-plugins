import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { experimental_usePluginId, useBbNavigate, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { PANEL_PATH } from "../constants";
import type { Atlas, Diagram, Snapshot } from "../contract";
import { DocPanel, ProblemList } from "./DocPanel";
import { FlowBar } from "./FlowBar";
import { Setup } from "./Setup";
import { Tooltip } from "./Tooltip";
import { ancestry, draftPrompt, edgeIn, edgesOf, nodeIn, nodesIn, otherEnd, usedPlaces, type Selection } from "./describe";
import { Stage, type Highlight, type Lens, type StageTarget } from "./stage/Stage";
import { useSnapshot } from "./useSnapshot";
import "./atlas.css";

interface Hover {
  target: StageTarget;
  point: { x: number; y: number };
  bounds: { width: number; height: number };
}

interface FlowState {
  id: string;
  index: number;
  playing: boolean;
  done: boolean;
  run: number;
}

const ADVANCE_MS = 650;

export function diagramFromSubPath(subPath: string): string {
  return subPath
    .split("/")
    .filter((segment) => segment !== "")
    .map((segment) => decodeURIComponent(segment))
    .join("/");
}

function usePersisted<T extends string | boolean>(key: string, fallback: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  });
  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        return;
      }
    },
    [key],
  );
  return [value, set];
}

function highlightFor(atlas: Atlas, diagram: Diagram, selection: Selection | null, hover: StageTarget | null, chip: string | null): Highlight | null {
  if (chip !== null) return { containers: [chip], nodes: nodesIn(atlas, diagram, chip).map(({ id }) => id) };
  if (hover?.kind === "trunk" && selection === null) {
    const riders = diagram.edges.filter(({ rides }) => rides.includes(hover.id));
    return { trunks: [hover.id], edges: riders.map(({ id }) => id), nodes: riders.flatMap(({ a, b }) => [a, b]) };
  }
  if (selection === null || selection.kind === "problems") return null;
  if (selection.kind === "node") {
    const edges = edgesOf(diagram, selection.id);
    return { nodes: [selection.id, ...edges.map((edge) => otherEnd(edge, selection.id))], edges: edges.map(({ id }) => id) };
  }
  if (selection.kind === "edge") {
    const edge = edgeIn(diagram, selection.id);
    return edge === undefined ? null : { edges: [edge.id], nodes: [edge.a, edge.b], trunks: edge.rides };
  }
  if (selection.kind === "trunk") {
    const riders = diagram.edges.filter(({ rides }) => rides.includes(selection.id));
    return { trunks: [selection.id], edges: riders.map(({ id }) => id), nodes: riders.flatMap(({ a, b }) => [a, b]) };
  }
  return { containers: [selection.id], nodes: nodesIn(atlas, diagram, selection.id).map(({ id }) => id) };
}

function Explorer({ snapshot, atlas, subPath }: { snapshot: Snapshot; atlas: Atlas; subPath: string }) {
  const navigate = useBbNavigate();
  const pluginId = experimental_usePluginId();
  const requested = diagramFromSubPath(subPath);
  const diagram = atlas.diagrams[requested] ?? atlas.diagrams[atlas.root];
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const pending = useRef<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [chip, setChip] = useState<string | null>(null);
  const [lens, setLens] = usePersisted<Lens>(`${pluginId}:lens`, "logical");
  const [live, setLive] = usePersisted<boolean>(`${pluginId}:live`, true);
  const [docsOpen, setDocsOpen] = usePersisted<boolean>(`${pluginId}:docs`, true);
  const [flow, setFlow] = useState<FlowState | null>(null);
  const [chosenFlow, setChosenFlow] = useState<string>("");

  const go = useCallback((id: string) => navigate.toPluginPanel(PANEL_PATH, { subPath: id === atlas.root ? "" : id }), [navigate, atlas.root]);

  const select = useCallback(
    (next: Selection | null) => {
      setSelection(next);
      if (next !== null) setDocsOpen(true);
    },
    [setDocsOpen],
  );

  const activateNode = useCallback(
    (nodeId: string) => {
      if (diagram === undefined) return;
      const node = nodeIn(diagram, nodeId);
      if (node === undefined) return;
      if (node.ref !== null) {
        const target = atlas.diagrams[node.ref.diagram];
        const end = target === undefined ? undefined : nodeIn(target, node.ref.node);
        if (end?.open !== null && end?.open !== undefined) return go(end.open);
        pending.current = node.ref.node;
        return go(node.ref.diagram);
      }
      if (node.open !== null) return go(node.open);
      select({ kind: "node", id: nodeId });
    },
    [atlas, diagram, go, select],
  );

  const handlers = useRef({ activateNode, select, setHover });
  handlers.current = { activateNode, select, setHover };

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const stage = new Stage(host, {
      hover: (target, point) => {
        const rect = host.getBoundingClientRect();
        handlers.current.setHover(target === null ? null : { target, point, bounds: { width: rect.width, height: rect.height } });
      },
      activate: (target) => {
        if (target.kind === "node") handlers.current.activateNode(target.id);
        else handlers.current.select({ kind: target.kind, id: target.id });
      },
      background: () => handlers.current.select(null),
    });
    stageRef.current = stage;
    return () => {
      stage.destroy();
      stageRef.current = null;
    };
  }, []);

  useEffect(() => {
    stageRef.current?.setAtlas(atlas);
  }, [atlas]);

  const diagramId = diagram?.id ?? atlas.root;
  useEffect(() => {
    const stage = stageRef.current;
    if (stage === null) return;
    setFlow(null);
    setHover(null);
    setSelection(null);
    let current = true;
    void stage.show(diagramId).then(() => {
      const nodeId = pending.current;
      pending.current = null;
      if (!current || nodeId === null || stage.diagramId !== diagramId) return;
      setSelection({ kind: "node", id: nodeId });
      stage.ping(nodeId);
    });
    return () => {
      current = false;
    };
  }, [diagramId]);

  const firstLens = useRef(true);
  useEffect(() => {
    stageRef.current?.setLens(lens, !firstLens.current);
    firstLens.current = false;
  }, [lens]);

  useEffect(() => {
    stageRef.current?.setLive(live);
  }, [live]);

  const activeFlow = flow === null || diagram === undefined ? undefined : diagram.flows.find(({ id }) => id === flow.id);
  const activeStep = flow === null ? undefined : activeFlow?.steps[flow.index];

  const highlight = useMemo(() => {
    if (diagram === undefined) return null;
    if (activeStep !== undefined) return { nodes: [activeStep.from, activeStep.to], edges: [activeStep.edge], live: activeStep.edge };
    return highlightFor(atlas, diagram, selection, hover?.target ?? null, chip);
  }, [atlas, diagram, selection, hover?.target, chip, activeStep]);

  useEffect(() => {
    stageRef.current?.highlight(highlight);
  }, [highlight]);

  useEffect(() => {
    if (flow === null || activeStep === undefined) return;
    let current = true;
    const { id, index, run } = flow;
    void stageRef.current?.pulse(activeStep.edge, activeStep.from).then(() => {
      if (current) setFlow((f) => (f !== null && f.id === id && f.index === index && f.run === run ? { ...f, done: true } : f));
    });
    return () => {
      current = false;
    };
  }, [flow?.id, flow?.index, flow?.run]);

  useEffect(() => {
    if (flow === null || !flow.done || !flow.playing || activeFlow === undefined) return;
    const last = activeFlow.steps.length - 1;
    const timer = setTimeout(
      () => setFlow((f) => (f === null ? f : f.index < last ? { ...f, index: f.index + 1, done: false, run: f.run + 1 } : { ...f, playing: false })),
      ADVANCE_MS,
    );
    return () => clearTimeout(timer);
  }, [flow?.done, flow?.playing, activeFlow]);

  const playFlow = useCallback((id: string) => {
    setSelection(null);
    setChosenFlow(id);
    setFlow((f) => ({ id, index: 0, playing: true, done: false, run: (f?.run ?? 0) + 1 }));
  }, []);

  const stepFlow = (delta: number) =>
    setFlow((f) => {
      if (f === null || activeFlow === undefined) return f;
      const index = Math.max(0, Math.min(activeFlow.steps.length - 1, f.index + delta));
      return { ...f, index, done: false, run: f.run + 1 };
    });

  const toggleFlow = () =>
    setFlow((f) => {
      if (f === null || activeFlow === undefined) return f;
      if (f.playing) return { ...f, playing: false };
      const restart = f.done && f.index === activeFlow.steps.length - 1;
      return restart ? { ...f, index: 0, playing: true, done: false, run: f.run + 1 } : { ...f, playing: true };
    });

  const draft = useCallback(
    (nodeId: string) => {
      const node = diagram === undefined ? undefined : nodeIn(diagram, nodeId);
      if (node === undefined || diagram === undefined) return;
      navigate.toCompose({ initialPrompt: draftPrompt(snapshot.directory, diagram, node), focusPrompt: true });
    },
    [diagram, navigate, snapshot.directory],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const element = event.target instanceof HTMLElement ? event.target : null;
      if (element?.closest("input, textarea, select, [contenteditable]") != null) return;
      if (flow !== null) setFlow(null);
      else if (selection !== null) setSelection(null);
      else if (diagram?.parent !== null && diagram?.parent !== undefined) go(diagram.parent.diagram);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [flow, selection, diagram, go]);

  if (diagram === undefined) return null;
  const trail = ancestry(atlas, diagram.id);
  const places = usedPlaces(diagram);
  const deploymentAvailable = diagram.deployment !== null;
  const flowChoice = diagram.flows.some(({ id }) => id === chosenFlow) ? chosenFlow : (diagram.flows[0]?.id ?? "");
  const segment = (value: Lens, label: string) => (
    <button
      type="button"
      aria-pressed={lens === value}
      onClick={() => setLens(value)}
      className={`rounded-md px-3 py-1 text-xs ${lens === value ? "bg-background font-semibold text-foreground shadow-xs" : "text-muted-foreground"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="atlas-root flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <nav aria-label="Breadcrumb" className="flex min-w-[200px] flex-1 flex-wrap items-center gap-1 text-sm font-semibold">
          {trail.map((item, index) => (
            <span key={item.id} className="flex items-center gap-1">
              {index > 0 && <span className="text-muted-foreground">›</span>}
              <button
                type="button"
                onClick={() => go(item.id)}
                aria-current={item.id === diagram.id ? "page" : undefined}
                className={`rounded-md px-2 py-0.5 hover:bg-accent ${item.id === diagram.id ? "text-foreground" : "text-muted-foreground"}`}
              >
                {item.title}
              </button>
            </span>
          ))}
        </nav>
        {snapshot.problems.length > 0 && (
          <button type="button" onClick={() => select({ kind: "problems" })} className="rounded-md border border-border px-2 py-1 text-xs text-warning-text hover:bg-accent">
            {snapshot.problems.length} problem{snapshot.problems.length === 1 ? "" : "s"}
          </button>
        )}
        {deploymentAvailable && (
          <div role="group" aria-label="Lens" className="inline-flex rounded-lg border border-border bg-secondary p-0.5">
            {segment("logical", "Logical")}
            {segment("deployment", "Deployment")}
          </div>
        )}
        {diagram.flows.length > 0 && (
          <div className="flex items-center gap-1.5">
            <select
              aria-label="Flow"
              value={flowChoice}
              onChange={(event) => setChosenFlow(event.target.value)}
              className="h-8 rounded-md border border-border bg-secondary px-2 text-xs text-secondary-foreground"
            >
              {diagram.flows.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => (flow !== null ? setFlow(null) : playFlow(flowChoice))}
              className="h-8 rounded-md bg-foreground px-3 text-xs font-medium text-background hover:bg-foreground/90"
            >
              {flow !== null ? "■ Stop" : "▶ Play flow"}
            </button>
          </div>
        )}
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={live} onChange={(event) => setLive(event.target.checked)} />
          Live traffic
        </label>
        <button
          type="button"
          aria-pressed={docsOpen}
          onClick={() => setDocsOpen(!docsOpen)}
          className="h-8 rounded-md border border-border px-2.5 text-xs text-muted-foreground hover:bg-accent aria-pressed:text-foreground"
        >
          Docs
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 lg:flex-row lg:overflow-hidden">
        <div className="flex min-w-0 flex-col gap-2 lg:min-h-0 lg:flex-1">
          <div className="atlas-viewport aspect-[16/10] w-full lg:aspect-auto lg:min-h-0 lg:flex-1">
            <div className="atlas-stage">
              <div ref={hostRef} className="absolute inset-0" data-testid="atlas-stage" />
              {hover !== null && flow === null && (
                <Tooltip atlas={atlas} diagram={diagram} lens={deploymentAvailable ? lens : "logical"} target={hover.target} point={hover.point} bounds={hover.bounds} />
              )}
              {flow !== null && activeFlow !== undefined && (
                <FlowBar diagram={diagram} flow={activeFlow} index={flow.index} playing={flow.playing} onStep={stepFlow} onToggle={toggleFlow} onClose={() => setFlow(null)} />
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            <span className="flex flex-wrap gap-3">
              <span className="flex items-center gap-1.5">
                <span className="atlas-swatch atlas-swatch-control" />
                Control
              </span>
              <span className="flex items-center gap-1.5">
                <span className="atlas-swatch atlas-swatch-user" />
                User plane
              </span>
              <span className="flex items-center gap-1.5">
                <span className="atlas-swatch atlas-swatch-api" />
                API
              </span>
              <span className="flex items-center gap-1.5">
                <span className="atlas-swatch atlas-swatch-data" />
                Data
              </span>
              {deploymentAvailable && lens === "deployment" && (
                <span className="flex items-center gap-1.5">
                  <span className="atlas-swatch atlas-swatch-trunk" />
                  Network path
                </span>
              )}
            </span>
            {places.length > 0 && (
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold">Runs on</span>
                {places.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onMouseEnter={() => setChip(id)}
                    onMouseLeave={() => setChip(null)}
                    onClick={() => select({ kind: "container", id })}
                    className="rounded-full border border-border bg-card px-2.5 py-0.5 text-foreground hover:border-warning"
                  >
                    {atlas.places[id]?.label ?? id}
                    <span className="ml-1 text-muted-foreground">{atlas.places[id]?.kind}</span>
                  </button>
                ))}
              </span>
            )}
          </div>
        </div>
        {docsOpen && (
        <div className="shrink-0 rounded-lg border border-border bg-card p-4 text-card-foreground lg:w-[340px] lg:overflow-auto">
          <DocPanel
            atlas={atlas}
            diagram={diagram}
            selection={selection}
            problems={snapshot.problems}
            select={select}
            activateNode={activateNode}
            playFlow={playFlow}
            draft={draft}
          />
        </div>
        )}
      </div>
    </div>
  );
}

export function AtlasPage({ subPath }: PluginNavPanelProps) {
  const { snapshot, error, refetch, setSnapshot } = useSnapshot();
  if (snapshot === null) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        {error === null ? (
          "Loading the atlas…"
        ) : (
          <span>
            {error}{" "}
            <button type="button" onClick={refetch} className="underline">
              Try again
            </button>
          </span>
        )}
      </div>
    );
  }
  if (snapshot.status !== "ready") return <Setup snapshot={snapshot} onReady={setSnapshot} />;
  if (snapshot.atlas === null) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-3 overflow-auto p-6 text-sm">
        <h2 className="text-lg font-semibold">No diagrams in {snapshot.directory} yet</h2>
        <p className="text-muted-foreground">Add an index.yaml with the top-level diagram, or ask an agent to map a system into this folder.</p>
        {snapshot.problems.length > 0 && <ProblemList problems={snapshot.problems} />}
      </div>
    );
  }
  return <Explorer snapshot={snapshot} atlas={snapshot.atlas} subPath={subPath} />;
}
