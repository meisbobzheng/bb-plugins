import type { ReactNode } from "react";
import { Markdown } from "@get-bb/plugin-sdk/app";
import type { Atlas, AtlasEdge, AtlasNode, Diagram, Problem } from "../contract";
import { Button } from "./ui/button";
import { KIND_LABEL, PLANE_LABEL, ancestry, edgeIn, edgesOf, nodeIn, nodesIn, otherEnd, placeTrail, type Selection } from "./describe";

export interface DocActions {
  select(selection: Selection | null): void;
  activateNode(nodeId: string): void;
  playFlow(flowId: string): void;
  draft(nodeId: string): void;
}

interface DocPanelProps extends DocActions {
  atlas: Atlas;
  diagram: Diagram;
  selection: Selection | null;
  problems: readonly Problem[];
}

function Kind({ children }: { children: ReactNode }) {
  return <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{children}</div>;
}

function Heading({ children, mono = false }: { children: ReactNode; mono?: boolean }) {
  return <h2 className={`mb-1.5 mt-0.5 text-lg font-semibold ${mono ? "font-mono" : ""}`}>{children}</h2>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4">
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Row({ onClick, children, aside }: { onClick?: () => void; children: ReactNode; aside?: ReactNode }) {
  const body = (
    <>
      <span className="flex min-w-0 items-center gap-2">{children}</span>
      {aside !== undefined && <span className="ml-auto shrink-0 truncate pl-2 text-right text-[11.5px] text-muted-foreground">{aside}</span>}
    </>
  );
  return (
    <li>
      {onClick === undefined ? (
        <div className="flex items-center rounded-md px-1.5 py-1">{body}</div>
      ) : (
        <button type="button" onClick={onClick} className="flex w-full items-center rounded-md px-1.5 py-1 text-left hover:bg-accent">
          {body}
        </button>
      )}
    </li>
  );
}

function Swatch({ edge }: { edge: AtlasEdge }) {
  return <span className={`atlas-swatch atlas-swatch-${edge.plane} shrink-0`} />;
}

function Body({ markdown }: { markdown: string }) {
  return markdown.trim() === "" ? null : (
    <div className="text-[13px]">
      <Markdown content={markdown} />
    </div>
  );
}

function Facts({ rows }: { rows: ReadonlyArray<readonly [string, string]> }) {
  if (rows.length === 0) return null;
  return (
    <Section title="Facts">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {rows.map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="text-muted-foreground">{key}</dt>
            <dd className="m-0 break-words font-mono text-[11.5px]">{value}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

export function ProblemList({ problems }: { problems: readonly Problem[] }) {
  return (
    <ul className="space-y-1.5 text-xs">
      {problems.map((problem, index) => (
        <li key={index} className="rounded-md border border-border px-2 py-1.5">
          <div className={`font-mono text-[11px] ${problem.severity === "error" ? "text-destructive-text" : "text-warning-text"}`}>
            {problem.file === null ? "atlas" : problem.line === null ? problem.file : `${problem.file}:${problem.line}`} · {problem.severity}
          </div>
          <div>{problem.message}</div>
        </li>
      ))}
    </ul>
  );
}

function DiagramDoc({ atlas, diagram, problems, ...actions }: Omit<DocPanelProps, "selection">) {
  const level = ancestry(atlas, diagram.id).length - 1;
  const real = diagram.nodes.filter(({ kind }) => kind !== "ref");
  const refs = diagram.nodes.filter(({ kind }) => kind === "ref");
  const own = problems.filter(({ file }) => file === diagram.file);
  return (
    <>
      <Kind>
        Diagram · level {level} · {diagram.file}
      </Kind>
      <Heading>{diagram.title}</Heading>
      {diagram.summary !== "" && <p className="mb-2 text-muted-foreground">{diagram.summary}</p>}
      <Body markdown={diagram.body} />
      <Section title="Components">
        <ul>
          {real.map((node) => (
            <Row key={node.id} onClick={() => actions.activateNode(node.id)} aside={node.open !== null ? "zoom ↘" : node.draft ? "not mapped" : node.sub}>
              <b className="truncate">{node.label}</b>
            </Row>
          ))}
        </ul>
      </Section>
      {refs.length > 0 && (
        <Section title="Connects out to">
          <ul>
            {refs.map((node) => (
              <Row key={node.id} onClick={() => actions.activateNode(node.id)} aside={node.sub}>
                {node.label}
              </Row>
            ))}
          </ul>
        </Section>
      )}
      {diagram.edges.length > 0 && (
        <Section title="Connections">
          <ul>
            {diagram.edges.map((edge) => (
              <Row key={edge.id} onClick={() => actions.select({ kind: "edge", id: edge.id })} aside={`${nodeIn(diagram, edge.a)?.label ?? edge.a} ↔ ${nodeIn(diagram, edge.b)?.label ?? edge.b}`}>
                <Swatch edge={edge} />
                <code className="truncate font-mono text-xs">{edge.label}</code>
              </Row>
            ))}
          </ul>
        </Section>
      )}
      {diagram.flows.length > 0 && (
        <Section title="Flows">
          <ul>
            {diagram.flows.map((flow) => (
              <Row key={flow.id} onClick={() => actions.playFlow(flow.id)} aside={`${flow.steps.length} steps`}>
                ▶ {flow.name}
              </Row>
            ))}
          </ul>
        </Section>
      )}
      {own.length > 0 && (
        <Section title="Problems in this file">
          <ProblemList problems={own} />
        </Section>
      )}
    </>
  );
}

function NodeDoc({ atlas, diagram, node, ...actions }: Omit<DocPanelProps, "selection" | "problems"> & { node: AtlasNode }) {
  const edges = edgesOf(diagram, node.id);
  const flows = diagram.flows.filter(({ steps }) => steps.some(({ from, to }) => from === node.id || to === node.id));
  const facts: Array<readonly [string, string]> = [...node.facts, ...(node.spec === "" ? [] : [["Spec", node.spec] as const])];
  return (
    <>
      <Kind>
        {KIND_LABEL[node.kind]} · in {diagram.title}
      </Kind>
      <Heading>{node.label}</Heading>
      {node.sub !== "" && <p className="-mt-1 mb-2 text-xs text-muted-foreground">{node.sub}</p>}
      {node.summary !== "" && <p className="mb-2 text-muted-foreground">{node.summary}</p>}
      {node.draft && (
        <div className="my-3 space-y-2 rounded-md border border-dashed border-border p-3">
          <p>Nothing is documented inside {node.label} yet. An agent can read the code you point it at and write its diagram for you.</p>
          <Button size="sm" onClick={() => actions.draft(node.id)}>
            ✦ Draft {node.label} with an agent
          </Button>
        </div>
      )}
      {node.open !== null && (
        <Button size="sm" variant="secondary" className="my-2" onClick={() => actions.activateNode(node.id)}>
          Open {node.label} ↘
        </Button>
      )}
      {node.ref !== null && (
        <Button size="sm" variant="secondary" className="my-2" onClick={() => actions.activateNode(node.id)}>
          Go to {atlas.diagrams[node.ref.diagram]?.title ?? node.ref.diagram} ↗
        </Button>
      )}
      <Body markdown={node.body} />
      <Facts rows={facts} />
      {node.place !== null && (
        <Section title="Runs on">
          <p className="text-xs">
            {placeTrail(atlas, node.place)}
            {node.replicas === null ? "" : <span className="font-mono text-muted-foreground"> · ×{node.replicas}</span>}
          </p>
        </Section>
      )}
      {edges.length > 0 && (
        <Section title="Connections">
          <ul>
            {edges.map((edge) => (
              <Row key={edge.id} onClick={() => actions.select({ kind: "edge", id: edge.id })} aside={`↔ ${nodeIn(diagram, otherEnd(edge, node.id))?.label ?? ""}`}>
                <Swatch edge={edge} />
                <code className="truncate font-mono text-xs">{edge.label}</code>
              </Row>
            ))}
          </ul>
        </Section>
      )}
      {flows.length > 0 && (
        <Section title="In flows">
          <ul>
            {flows.map((flow) => (
              <Row key={flow.id} onClick={() => actions.playFlow(flow.id)}>
                ▶ {flow.name}
              </Row>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

function EdgeDoc({ atlas, diagram, edge, ...actions }: Omit<DocPanelProps, "selection" | "problems"> & { edge: AtlasEdge }) {
  const flows = diagram.flows.filter(({ steps }) => steps.some((step) => step.edge === edge.id));
  const a = nodeIn(diagram, edge.a);
  const b = nodeIn(diagram, edge.b);
  return (
    <>
      <Kind>
        Connection · {PLANE_LABEL[edge.plane]}
        {edge.derived ? ` · rolled up from ${atlas.diagrams[edge.from ?? ""]?.title ?? edge.from}` : ""}
      </Kind>
      <Heading mono>{edge.label}</Heading>
      <p className="mb-2 text-muted-foreground">
        {a?.label ?? edge.a} ↔ {b?.label ?? edge.b}
      </p>
      {edge.summary !== "" && <p className="mb-2">{edge.summary}</p>}
      {edge.spec !== "" && (
        <Section title="Spec">
          <code className="font-mono text-xs">{edge.spec}</code>
        </Section>
      )}
      {edge.parts.length > 0 && (
        <Section title={edge.derived ? "Made of" : "One level down"}>
          <ul>
            {edge.parts.map((part) => (
              <Row key={`${part.label}|${part.a}|${part.b}`} aside={`${part.a} ↔ ${part.b}`}>
                <span className={`atlas-swatch atlas-swatch-${part.plane} shrink-0`} />
                <code className="font-mono text-xs">{part.label}</code>
              </Row>
            ))}
          </ul>
        </Section>
      )}
      {edge.rides.length > 0 && (
        <Section title="Rides">
          <ul>
            {edge.rides.map((id) => (
              <Row key={id} onClick={() => actions.select({ kind: "trunk", id })} aside={atlas.paths[id]?.summary}>
                <span className="atlas-swatch atlas-swatch-trunk shrink-0" />
                {atlas.paths[id]?.label ?? id}
              </Row>
            ))}
          </ul>
        </Section>
      )}
      {flows.length > 0 && (
        <Section title="Used in flows">
          <ul>
            {flows.map((flow) => (
              <Row key={flow.id} onClick={() => actions.playFlow(flow.id)}>
                ▶ {flow.name}
              </Row>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

function PlaceDoc({ atlas, diagram, placeId, ...actions }: Omit<DocPanelProps, "selection" | "problems"> & { placeId: string }) {
  const place = atlas.places[placeId];
  const nodes = nodesIn(atlas, diagram, placeId);
  return (
    <>
      <Kind>Infrastructure · {place?.kind ?? "place"}</Kind>
      <Heading>{place?.label ?? placeId}</Heading>
      <p className="mb-2 text-xs text-muted-foreground">{placeTrail(atlas, placeId)}</p>
      {place?.summary !== undefined && place.summary !== "" && <p className="mb-2">{place.summary}</p>}
      <Section title="Runs here">
        <ul>
          {nodes.map((node) => (
            <Row key={node.id} onClick={() => actions.select({ kind: "node", id: node.id })} aside={node.replicas === null ? node.sub : `×${node.replicas}`}>
              <b>{node.label}</b>
            </Row>
          ))}
        </ul>
      </Section>
    </>
  );
}

function PathDoc({ atlas, diagram, pathId, ...actions }: Omit<DocPanelProps, "selection" | "problems"> & { pathId: string }) {
  const path = atlas.paths[pathId];
  const riders = diagram.edges.filter(({ rides }) => rides.includes(pathId));
  const endName = (end: string) => atlas.places[end]?.label ?? end;
  return (
    <>
      <Kind>Network path</Kind>
      <Heading>{path?.label ?? pathId}</Heading>
      {path !== undefined && (
        <p className="mb-2 text-muted-foreground">
          {endName(path.between[0])} ↔ {endName(path.between[1])}
        </p>
      )}
      {path?.summary !== undefined && path.summary !== "" && <p className="mb-2">{path.summary}</p>}
      <Section title="Carries">
        <ul>
          {riders.map((edge) => (
            <Row key={edge.id} onClick={() => actions.select({ kind: "edge", id: edge.id })} aside={`${nodeIn(diagram, edge.a)?.label} ↔ ${nodeIn(diagram, edge.b)?.label}`}>
              <Swatch edge={edge} />
              <code className="font-mono text-xs">{edge.label}</code>
            </Row>
          ))}
        </ul>
      </Section>
    </>
  );
}

export function DocPanel(props: DocPanelProps) {
  const { selection, diagram } = props;
  const node = selection?.kind === "node" ? nodeIn(diagram, selection.id) : undefined;
  const edge = selection?.kind === "edge" ? edgeIn(diagram, selection.id) : undefined;
  return (
    <aside aria-label="Documentation" className="text-[13px] leading-relaxed">
      {selection?.kind === "problems" ? (
        <>
          <Kind>Atlas</Kind>
          <Heading>Problems</Heading>
          <p className="mb-3 text-muted-foreground">Fix these in the YAML files. The atlas reloads as soon as you save.</p>
          <ProblemList problems={props.problems} />
        </>
      ) : node !== undefined ? (
        <NodeDoc {...props} node={node} />
      ) : edge !== undefined ? (
        <EdgeDoc {...props} edge={edge} />
      ) : selection?.kind === "container" ? (
        <PlaceDoc {...props} placeId={selection.id} />
      ) : selection?.kind === "trunk" ? (
        <PathDoc {...props} pathId={selection.id} />
      ) : (
        <DiagramDoc {...props} />
      )}
    </aside>
  );
}
