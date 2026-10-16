import type { Element } from "../model";
import { elementBox, unionBoxes } from "./geometry";

const SVG_NS = "http://www.w3.org/2000/svg";
const MAX_SIDE = 1600;
const PADDING = 32;
const INK = "#1f2328";
const PAPER = "#ffffff";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not render the board snapshot"));
    image.src = src;
  });
}

export async function renderSnapshot(
  content: SVGGElement,
  elements: readonly Element[],
): Promise<string | null> {
  const bounds = unionBoxes(elements.map(elementBox));
  if (bounds === null) return null;
  const x = bounds.x - PADDING;
  const y = bounds.y - PADDING;
  const w = bounds.w + PADDING * 2;
  const h = bounds.h + PADDING * 2;
  const scale = Math.min(2, MAX_SIDE / Math.max(w, h));
  const width = Math.max(1, Math.round(w * scale));
  const height = Math.max(1, Math.round(h * scale));

  const clone = content.cloneNode(true) as SVGGElement;
  clone.removeAttribute("transform");
  for (const node of clone.querySelectorAll("[visibility]")) node.removeAttribute("visibility");

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("color", INK);
  const paper = document.createElementNS(SVG_NS, "rect");
  for (const [name, value] of Object.entries({ x, y, width: w, height: h, fill: PAPER })) {
    paper.setAttribute(name, String(value));
  }
  svg.append(paper, clone);

  const markup = new XMLSerializer().serializeToString(svg);
  const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) return null;
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/png");
}
