import type { Board, Element, Point } from "./model.js";

const MAX_CONTEXT_CHARS = 24_000;
const CONNECT_TOLERANCE = 24;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Labeled = { box: Box; label: string };

const KIND_NAMES: Record<string, [string, string]> = {
  pen: ["freehand stroke", "freehand strokes"],
  line: ["line", "lines"],
  arrow: ["arrow", "arrows"],
  rect: ["rectangle", "rectangles"],
  ellipse: ["ellipse", "ellipses"],
  diamond: ["diamond", "diamonds"],
  triangle: ["triangle", "triangles"],
  polygon: ["polygon", "polygons"],
};

function kindOf(element: Element): string {
  switch (element.type) {
    case "line":
      return element.arrow ? "arrow" : "line";
    case "shape":
      return element.kind;
    default:
      return element.type;
  }
}

function approximateBox(element: Element): Box | null {
  switch (element.type) {
    case "shape":
    case "note":
      return { x: element.x, y: element.y, w: element.w, h: element.h };
    case "text": {
      const lines = element.text.split("\n");
      const longest = Math.max(...lines.map((line) => line.length));
      return {
        x: element.x,
        y: element.y,
        w: longest * element.size * 0.6,
        h: lines.length * element.size * 1.25,
      };
    }
    case "polygon": {
      const xs = element.points.map(([x]) => x);
      const ys = element.points.map(([, y]) => y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }
    default:
      return null;
  }
}

function contains(box: Box, [px, py]: Point, tolerance = 0): boolean {
  return (
    px >= box.x - tolerance &&
    px <= box.x + box.w + tolerance &&
    py >= box.y - tolerance &&
    py <= box.y + box.h + tolerance
  );
}

function quote(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return JSON.stringify(flat.length > 80 ? `${flat.slice(0, 77)}...` : flat);
}

function readingOrder(a: Pick<Box, "x" | "y">, b: Pick<Box, "x" | "y">): number {
  return Math.abs(a.y - b.y) > 16 ? a.y - b.y : a.x - b.x;
}

function labelBoxes(elements: readonly Element[]): Labeled[] {
  const texts = elements.filter(
    (element): element is Extract<Element, { type: "text" }> =>
      element.type === "text" && element.text.trim() !== "",
  );
  const captions = new Set<Element>();
  const labeled: Labeled[] = [];
  for (const element of elements) {
    const box = approximateBox(element);
    if (box === null || element.type === "text") continue;
    if (element.type === "note") {
      labeled.push({ box, label: quote(element.text) || "empty sticky note" });
      continue;
    }
    const name = KIND_NAMES[kindOf(element)]![0];
    const caption = texts.find((text) => contains(box, [text.x, text.y]));
    if (caption !== undefined) captions.add(caption);
    labeled.push({ box, label: caption ? `${name} ${quote(caption.text)}` : name });
  }
  for (const text of texts) {
    if (!captions.has(text)) labeled.push({ box: approximateBox(text)!, label: quote(text.text) });
  }
  return labeled;
}

function endpointTarget(labeled: readonly Labeled[], point: Point): string {
  for (let index = labeled.length - 1; index >= 0; index -= 1) {
    const candidate = labeled[index]!;
    if (contains(candidate.box, point, CONNECT_TOLERANCE)) return candidate.label;
  }
  return `(${Math.round(point[0])}, ${Math.round(point[1])})`;
}

export function summarizeBoard(board: Board, hasImage: boolean): string {
  const { elements } = board;
  const sections: string[] = [
    `# Scratchpad board ${quote(board.name)}`,
    `Last updated ${board.updatedAt}. This is a freeform whiteboard the user sketched in; positions are canvas pixels.`,
  ];
  if (hasImage) sections.push("The attached image is a rendering of the whole board.");
  if (elements.length === 0) {
    sections.push("The board is empty.");
    return sections.join("\n\n");
  }

  const writing = elements
    .filter(
      (element): element is Extract<Element, { type: "text" | "note" }> =>
        (element.type === "text" || element.type === "note") &&
        element.text.trim() !== "",
    )
    .sort((a, b) => readingOrder(a, b));
  if (writing.length > 0) {
    sections.push(
      [
        "## Notes and text (reading order)",
        ...writing.map(
          (element) =>
            `- ${element.type === "note" ? "Sticky note" : "Text"} at (${Math.round(element.x)}, ${Math.round(element.y)}):\n${element.text
              .trim()
              .split("\n")
              .map((line) => `  > ${line}`)
              .join("\n")}`,
        ),
      ].join("\n"),
    );
  }

  const labeled = labelBoxes(elements);
  const connections = elements
    .filter(
      (element): element is Extract<Element, { type: "line" }> =>
        element.type === "line",
    )
    .map((line) => {
      const [from, to] = line.points;
      const joiner = line.arrow ? "→" : "—";
      return `- ${endpointTarget(labeled, from)} ${joiner} ${endpointTarget(labeled, to)}`;
    });
  if (connections.length > 0) {
    sections.push(["## Lines and arrows", ...connections].join("\n"));
  }

  const counts = new Map<string, number>();
  for (const element of elements) {
    const kind = kindOf(element);
    if (kind in KIND_NAMES) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  if (counts.size > 0) {
    sections.push(
      `## Drawings\n${[...counts]
        .map(([kind, count]) => `${count} ${KIND_NAMES[kind]![count === 1 ? 0 : 1]}`)
        .join(", ")}`,
    );
  }

  const context = sections.join("\n\n");
  return context.length > MAX_CONTEXT_CHARS
    ? `${context.slice(0, MAX_CONTEXT_CHARS)}\n\n[truncated]`
    : context;
}
