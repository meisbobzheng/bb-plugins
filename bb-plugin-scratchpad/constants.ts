export const COLORS = [
  "ink",
  "gray",
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
] as const;

export const SHAPE_KINDS = ["rect", "ellipse", "diamond", "triangle"] as const;

export const BOARDS_CHANGED = "boards-changed";
export interface BoardsChangedSignal {
  boardId: string;
  clientId: string | null;
}
