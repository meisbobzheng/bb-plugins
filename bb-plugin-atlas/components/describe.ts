import type { Atlas, AtlasEdge, AtlasNode, Diagram, NodeKind, Plane } from "../contract";
import { ROOT_DIAGRAM } from "../constants";

export const KIND_LABEL: Record<NodeKind, string> = {
  service: "Service",
  system: "System",
  external: "External",
  store: "Datastore",
  ref: "Reference",
};

export const PLANE_LABEL: Record<Plane, string> = {
  control: "Control plane",
  user: "User plane",
  api: "API",
  data: "Data",
};

export type Selection =
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string }
  | { kind: "container"; id: string }
  | { kind: "trunk"; id: string }
  | { kind: "problems" };

export const nodeIn = (diagram: Diagram, id: string): AtlasNode | undefined => diagram.nodes.find((node) => node.id === id);
export const edgeIn = (diagram: Diagram, id: string): AtlasEdge | undefined => diagram.edges.find((edge) => edge.id === id);
export const edgesOf = (diagram: Diagram, nodeId: string): AtlasEdge[] => diagram.edges.filter(({ a, b }) => a === nodeId || b === nodeId);
export const otherEnd = (edge: AtlasEdge, nodeId: string): string => (edge.a === nodeId ? edge.b : edge.a);

export function placeTrail(atlas: Atlas, placeId: string | null): string {
  const trail: string[] = [];
  for (let at = placeId; at !== null && trail.length < 20; at = atlas.places[at]?.parent ?? null) trail.unshift(atlas.places[at]?.label ?? at);
  return trail.join(" › ");
}

export function isWithin(atlas: Atlas, placeId: string | null, ancestor: string): boolean {
  for (let at = placeId, hops = 0; at !== null && hops < 20; at = atlas.places[at]?.parent ?? null, hops += 1) {
    if (at === ancestor) return true;
  }
  return false;
}

export const nodesIn = (atlas: Atlas, diagram: Diagram, placeId: string): AtlasNode[] => diagram.nodes.filter(({ place }) => isWithin(atlas, place, placeId));

export function ancestry(atlas: Atlas, diagramId: string): Diagram[] {
  const out: Diagram[] = [];
  for (let id: string | null = diagramId; id !== null && out.length < 32; id = atlas.diagrams[id]?.parent?.diagram ?? null) {
    const diagram = atlas.diagrams[id];
    if (diagram === undefined) break;
    out.unshift(diagram);
  }
  return out;
}

export function usedPlaces(diagram: Diagram): string[] {
  return [...new Set(diagram.nodes.flatMap(({ place }) => (place === null ? [] : [place])))];
}

export function childIdFor(diagram: Diagram, node: AtlasNode): string {
  return diagram.id === ROOT_DIAGRAM ? node.id : `${diagram.id.replace(/\/index$/, "")}/${node.id}`;
}

export function draftPrompt(directory: string, diagram: Diagram, node: AtlasNode): string {
  const child = childIdFor(diagram, node);
  return [
    `Map the ${node.label} system into my Atlas in ${directory}.`,
    `${node.label} is the node \`${node.id}\` in ${diagram.file}${node.summary === "" ? "." : `: ${node.summary}`}`,
    "Find its components in the code and docs I point you to, and ask me where they are if you don't know.",
    `Write ${child}.yaml with a diagram of its services, the connections between them, how it connects to the rest of the atlas through \`ref\` nodes, and its main flows.`,
    "Name 3GPP interfaces and network functions as the specs do, and look each one up with telecom_ref_lookup for its `spec`.",
    `Then add \`open: ${child}\` to \`${node.id}\` in ${diagram.file}, and run atlas_check until it reports no problems.`,
  ].join(" ");
}
