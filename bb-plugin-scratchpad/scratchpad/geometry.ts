import type { Element, Point, ShapeKind } from "../model";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FONT_FAMILY = "ui-sans-serif, system-ui, -apple-system, sans-serif";
export const LINE_HEIGHT = 1.25;
export const NOTE_PADDING = 12;
export const NOTE_FONT_SIZE = 15;

let measureContext: CanvasRenderingContext2D | null = null;

function measure(text: string, size: number): number {
  measureContext ??= document.createElement("canvas").getContext("2d");
  if (measureContext === null) return text.length * size * 0.6;
  measureContext.font = `${size}px ${FONT_FAMILY}`;
  return measureContext.measureText(text).width;
}

export function wrapLines(text: string, maxWidth: number, size: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/(?<=\s)/)) {
      const candidate = line + word;
      if (line !== "" && measure(candidate.trimEnd(), size) > maxWidth) {
        lines.push(line.trimEnd());
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export function noteLines(note: Extract<Element, { type: "note" }>): string[] {
  return wrapLines(note.text, Math.max(note.w - NOTE_PADDING * 2, 1), NOTE_FONT_SIZE);
}

export function noteHeight(note: Extract<Element, { type: "note" }>): number {
  const content = noteLines(note).length * NOTE_FONT_SIZE * LINE_HEIGHT;
  return Math.max(note.h, content + NOTE_PADDING * 2);
}

export function textBox(element: Extract<Element, { type: "text" }>): Box {
  const lines = element.text.split("\n");
  const w = Math.max(element.size * 0.5, ...lines.map((line) => measure(line, element.size)));
  return { x: element.x, y: element.y, w, h: lines.length * element.size * LINE_HEIGHT };
}

export function normalizeBox([x1, y1]: Point, [x2, y2]: Point): Box {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1),
  };
}

function pointsBox(points: readonly Point[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function unionBoxes(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  return pointsBox(boxes.flatMap((box) => [[box.x, box.y], [box.x + box.w, box.y + box.h]] as Point[]));
}

export function shapePoints(kind: ShapeKind, { x, y, w, h }: Box): Point[] {
  switch (kind) {
    case "diamond":
      return [[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]];
    case "triangle":
      return [[x + w / 2, y], [x + w, y + h], [x, y + h]];
    default:
      return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  }
}

export function elementBox(element: Element): Box {
  switch (element.type) {
    case "pen":
    case "line":
    case "polygon":
      return pointsBox(element.points);
    case "shape":
      return { x: element.x, y: element.y, w: element.w, h: element.h };
    case "note":
      return { x: element.x, y: element.y, w: element.w, h: noteHeight(element) };
    case "text":
      return textBox(element);
  }
}

function distanceToSegment([px, py]: Point, [ax, ay]: Point, [bx, by]: Point): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function nearPolyline(point: Point, points: readonly Point[], tolerance: number, closed: boolean) {
  if (points.length === 1) return Math.hypot(point[0] - points[0]![0], point[1] - points[0]![1]) <= tolerance;
  const count = closed ? points.length : points.length - 1;
  for (let index = 0; index < count; index += 1) {
    if (distanceToSegment(point, points[index]!, points[(index + 1) % points.length]!) <= tolerance) return true;
  }
  return false;
}

function insidePolygon([px, py]: Point, points: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i]!;
    const [xj, yj] = points[j]!;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function insideBox([px, py]: Point, box: Box, tolerance = 0): boolean {
  return (
    px >= box.x - tolerance &&
    px <= box.x + box.w + tolerance &&
    py >= box.y - tolerance &&
    py <= box.y + box.h + tolerance
  );
}

export function hitTest(element: Element, point: Point, tolerance: number): boolean {
  switch (element.type) {
    case "pen":
    case "line":
      return nearPolyline(point, element.points, tolerance + element.width / 2, false);
    case "polygon":
      return (
        insidePolygon(point, element.points) ||
        nearPolyline(point, element.points, tolerance + element.width / 2, true)
      );
    case "shape": {
      const box = elementBox(element);
      if (element.kind === "rect") return insideBox(point, box, tolerance);
      if (element.kind === "ellipse") {
        const rx = box.w / 2 + tolerance;
        const ry = box.h / 2 + tolerance;
        const dx = point[0] - (box.x + box.w / 2);
        const dy = point[1] - (box.y + box.h / 2);
        return rx > 0 && ry > 0 && (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
      }
      const outline = shapePoints(element.kind, box);
      return insidePolygon(point, outline) || nearPolyline(point, outline, tolerance, true);
    }
    case "note":
    case "text":
      return insideBox(point, elementBox(element), tolerance);
  }
}

export function intersectsBox(element: Element, area: Box): boolean {
  const box = elementBox(element);
  return (
    box.x <= area.x + area.w &&
    box.x + box.w >= area.x &&
    box.y <= area.y + area.h &&
    box.y + box.h >= area.y
  );
}

export function translate(element: Element, dx: number, dy: number): Element {
  switch (element.type) {
    case "pen":
    case "polygon":
      return { ...element, points: element.points.map(([x, y]) => [x + dx, y + dy] as Point) };
    case "line": {
      const [[x1, y1], [x2, y2]] = element.points;
      return { ...element, points: [[x1 + dx, y1 + dy], [x2 + dx, y2 + dy]] };
    }
    default:
      return { ...element, x: element.x + dx, y: element.y + dy };
  }
}

export function fitToBox(element: Element, from: Box, to: Box): Element {
  const sx = from.w === 0 ? 1 : to.w / from.w;
  const sy = from.h === 0 ? 1 : to.h / from.h;
  const map = ([x, y]: Point): Point => [to.x + (x - from.x) * sx, to.y + (y - from.y) * sy];
  switch (element.type) {
    case "pen":
    case "polygon":
      return { ...element, points: element.points.map(map) };
    case "line":
      return { ...element, points: [map(element.points[0]), map(element.points[1])] };
    case "text":
      return { ...element, x: to.x, y: to.y, size: Math.max(6, Math.min(400, element.size * sy)) };
    case "shape":
    case "note":
      return { ...element, x: to.x, y: to.y, w: to.w, h: to.h };
  }
}

export function snapAngle([x1, y1]: Point, [x2, y2]: Point): Point {
  const angle = Math.round(Math.atan2(y2 - y1, x2 - x1) / (Math.PI / 4)) * (Math.PI / 4);
  const length = Math.hypot(x2 - x1, y2 - y1);
  return [x1 + Math.cos(angle) * length, y1 + Math.sin(angle) * length];
}

export function round(value: number): number {
  return Math.round(value * 10) / 10;
}
