export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const SAME_COLUMN = 8;

export function comparePosition(a: Box, b: Box): number {
  return Math.abs(a.left - b.left) > SAME_COLUMN ? a.left - b.left : a.top - b.top;
}

export function centerY(box: Box): number {
  return box.top + box.height / 2;
}

export function area(box: Box): number {
  return box.width * box.height;
}

function overlap(a: Box, b: Box): number {
  const width = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const height = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return width > 0 && height > 0 ? width * height : 0;
}

export function coverage(parent: Box, children: readonly Box[]): number {
  const total = area(parent);
  return total === 0 ? 1 : children.reduce((sum, child) => sum + overlap(parent, child), 0) / total;
}

export function nearestTo(boxes: readonly Box[], y: number): number {
  return boxes.reduce(
    (best, box, index) => (best < 0 || Math.abs(centerY(box) - y) < Math.abs(centerY(boxes[best]!) - y) ? index : best),
    -1,
  );
}

export function inViewport(box: Box, width: number, height: number): boolean {
  return box.width > 0 && box.height > 0 && box.left < width && box.top < height && box.left + box.width > 0 && box.top + box.height > 0;
}
