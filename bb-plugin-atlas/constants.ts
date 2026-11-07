export const PLANES = ["control", "user", "api", "data"] as const;
export const NODE_KINDS = ["service", "system", "external", "store", "ref"] as const;
export const PLACE_KINDS = ["region", "site", "cluster", "namespace", "group"] as const;
export const CHANGED_CHANNEL = "atlas-changed";
export const PANEL_PATH = "atlas";
export const ROOT_DIAGRAM = "index";
export const INFRA_FILE = "infra";

export type Plane = (typeof PLANES)[number];
export type NodeKind = (typeof NODE_KINDS)[number];
export type PlaceKind = (typeof PLACE_KINDS)[number];
