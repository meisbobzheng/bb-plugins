import { useLayoutEffect, useRef, useState } from "react";
import type { Atlas, Diagram } from "../contract";
import { KIND_LABEL, PLANE_LABEL, edgeIn, nodeIn, nodesIn, placeTrail } from "./describe";
import type { Lens, StageTarget } from "./stage/Stage";

interface TooltipProps {
  atlas: Atlas;
  diagram: Diagram;
  lens: Lens;
  target: StageTarget;
  point: { x: number; y: number };
  bounds: { width: number; height: number };
}

function Content({ atlas, diagram, lens, target }: Omit<TooltipProps, "point" | "bounds">) {
  if (target.kind === "node") {
    const node = nodeIn(diagram, target.id);
    if (node === undefined) return null;
    const hint =
      node.ref !== null
        ? `Click to go to ${atlas.diagrams[node.ref.diagram]?.title ?? node.ref.diagram} ↗`
        : node.open !== null
          ? "Click to zoom in ↘"
          : node.draft
            ? "Click to draft this system"
            : "Click for docs";
    return (
      <>
        <Title text={node.label} kind={KIND_LABEL[node.kind]} />
        {node.summary !== "" && <p>{node.summary}</p>}
        {lens === "deployment" && node.place !== null && (
          <p className="atlas-text-trunk font-mono text-[11px]">
            {placeTrail(atlas, node.place)}
            {node.replicas === null ? "" : ` · ${node.replicas} replicas`}
          </p>
        )}
        <p className="font-semibold text-foreground">{hint}</p>
      </>
    );
  }
  if (target.kind === "edge") {
    const edge = edgeIn(diagram, target.id);
    if (edge === undefined) return null;
    const a = nodeIn(diagram, edge.a)?.label ?? edge.a;
    const b = nodeIn(diagram, edge.b)?.label ?? edge.b;
    return (
      <>
        <Title text={edge.label} kind={`${PLANE_LABEL[edge.plane]}${edge.derived ? " · rolled up" : ""}`} mono />
        <p className="text-muted-foreground">
          {a} ↔ {b}
          {edge.spec === "" ? "" : ` · ${edge.spec}`}
        </p>
        {edge.summary !== "" && <p>{edge.summary}</p>}
        {edge.parts.length > 0 && <p className="text-muted-foreground">Includes {edge.parts.map(({ label }) => label).join(", ")}</p>}
        {edge.rides.length > 0 && <p className="atlas-text-trunk font-mono text-[11px]">rides {edge.rides.map((id) => atlas.paths[id]?.label ?? id).join(" → ")}</p>}
      </>
    );
  }
  if (target.kind === "trunk") {
    const path = atlas.paths[target.id];
    const riders = diagram.edges.filter(({ rides }) => rides.includes(target.id));
    return (
      <>
        <Title text={path?.label ?? target.id} kind="Network path" />
        {path?.summary !== undefined && path.summary !== "" && <p>{path.summary}</p>}
        <p className="font-mono text-[11px]">{riders.map(({ label }) => label).join("  ")}</p>
      </>
    );
  }
  const place = atlas.places[target.id];
  return (
    <>
      <Title text={place?.label ?? target.id} kind={place?.kind ?? "place"} />
      {place?.summary !== undefined && place.summary !== "" && <p>{place.summary}</p>}
      <p className="text-muted-foreground">{nodesIn(atlas, diagram, target.id).map(({ label }) => label).join(", ")}</p>
    </>
  );
}

function Title({ text, kind, mono = false }: { text: string; kind: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className={mono ? "font-mono text-[13px] font-semibold" : "text-[13px] font-semibold"}>{text}</span>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{kind}</span>
    </div>
  );
}

export function Tooltip({ point, bounds, ...rest }: TooltipProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (element !== null && (element.offsetWidth !== size.width || element.offsetHeight !== size.height)) {
      setSize({ width: element.offsetWidth, height: element.offsetHeight });
    }
  });
  let left = point.x + 14;
  let top = point.y + 14;
  if (left + size.width > bounds.width - 6) left = point.x - size.width - 14;
  if (top + size.height > bounds.height - 6) top = point.y - size.height - 14;
  return (
    <div
      ref={ref}
      role="tooltip"
      className="pointer-events-none absolute z-10 max-w-[290px] space-y-1 rounded-lg border border-border bg-popover px-3 py-2.5 text-xs leading-relaxed text-popover-foreground shadow-md"
      style={{ left: Math.max(6, left), top: Math.max(6, top) }}
    >
      <Content {...rest} />
    </div>
  );
}
