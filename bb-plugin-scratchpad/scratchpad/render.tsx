import { memo } from "react";
import type { Color, Element, Point } from "../model";
import {
  FONT_FAMILY,
  LINE_HEIGHT,
  NOTE_FONT_SIZE,
  NOTE_PADDING,
  elementBox,
  noteHeight,
  noteLines,
  shapePoints,
} from "./geometry";

export const PALETTE: Record<Color, string> = {
  ink: "currentColor",
  gray: "#8b8d98",
  red: "#e5484d",
  orange: "#f76b15",
  yellow: "#ffc53d",
  green: "#30a46c",
  blue: "#0090ff",
  purple: "#8e4ec6",
};

const FILL_OPACITY = 0.2;
const NOTE_OPACITY = 0.32;

function pointList(points: readonly Point[]): string {
  return points.map(([x, y]) => `${x},${y}`).join(" ");
}

function penPath(points: readonly Point[]): string {
  const [first, ...rest] = points;
  if (first === undefined) return "";
  if (rest.length === 0) return `M ${first[0]} ${first[1]} l 0.01 0`;
  let path = `M ${first[0]} ${first[1]}`;
  for (let index = 0; index < rest.length - 1; index += 1) {
    const [x, y] = rest[index]!;
    const [nx, ny] = rest[index + 1]!;
    path += ` Q ${x} ${y} ${(x + nx) / 2} ${(y + ny) / 2}`;
  }
  const [lx, ly] = rest[rest.length - 1]!;
  return `${path} L ${lx} ${ly}`;
}

function arrowHead([x1, y1]: Point, [x2, y2]: Point, width: number): string {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const length = Math.max(10, width * 3.5);
  const spread = Math.PI / 7;
  const left: Point = [x2 - length * Math.cos(angle - spread), y2 - length * Math.sin(angle - spread)];
  const right: Point = [x2 - length * Math.cos(angle + spread), y2 - length * Math.sin(angle + spread)];
  return `M ${left[0]} ${left[1]} L ${x2} ${y2} L ${right[0]} ${right[1]}`;
}

function TextLines({
  lines,
  x,
  y,
  size,
  fill,
}: {
  lines: readonly string[];
  x: number;
  y: number;
  size: number;
  fill: string;
}) {
  const lineHeight = size * LINE_HEIGHT;
  const inset = (lineHeight - size) / 2;
  return (
    <g fill={fill} fontSize={size} fontFamily={FONT_FAMILY} style={{ whiteSpace: "pre" }}>
      {lines.map((line, index) => (
        <text key={index} x={x} y={y + index * lineHeight + inset} dominantBaseline="text-before-edge">
          {line}
        </text>
      ))}
    </g>
  );
}

function ElementShape({ element, editing }: { element: Element; editing: boolean }) {
  const stroke = PALETTE[element.color];
  switch (element.type) {
    case "pen":
      return (
        <path
          d={penPath(element.points)}
          fill="none"
          stroke={stroke}
          strokeWidth={element.width}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case "line": {
      const [from, to] = element.points;
      return (
        <path
          d={`M ${from[0]} ${from[1]} L ${to[0]} ${to[1]}${element.arrow ? ` ${arrowHead(from, to, element.width)}` : ""}`}
          fill="none"
          stroke={stroke}
          strokeWidth={element.width}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    }
    case "polygon":
    case "shape": {
      const common = {
        fill: element.fill ? stroke : "none",
        fillOpacity: FILL_OPACITY,
        stroke,
        strokeWidth: element.width,
        strokeLinejoin: "round" as const,
      };
      if (element.type === "polygon") return <polygon points={pointList(element.points)} {...common} />;
      const box = elementBox(element);
      if (element.kind === "ellipse") {
        return <ellipse cx={box.x + box.w / 2} cy={box.y + box.h / 2} rx={box.w / 2} ry={box.h / 2} {...common} />;
      }
      if (element.kind === "rect") return <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={4} {...common} />;
      return <polygon points={pointList(shapePoints(element.kind, box))} {...common} />;
    }
    case "text":
      return <TextLines lines={element.text.split("\n")} x={element.x} y={element.y} size={element.size} fill={stroke} />;
    case "note":
      return (
        <g>
          <rect
            x={element.x}
            y={element.y}
            width={element.w}
            height={noteHeight(element)}
            rx={6}
            fill={stroke}
            fillOpacity={element.color === "ink" ? 0.1 : NOTE_OPACITY}
            stroke={stroke}
            strokeOpacity={0.5}
          />
          <TextLines
            lines={editing ? [] : noteLines(element)}
            x={element.x + NOTE_PADDING}
            y={element.y + NOTE_PADDING}
            size={NOTE_FONT_SIZE}
            fill="currentColor"
          />
        </g>
      );
  }
}

export const ElementView = memo(function ElementView({
  element,
  editing,
}: {
  element: Element;
  editing: boolean;
}) {
  return (
    <g visibility={editing && element.type === "text" ? "hidden" : undefined}>
      <ElementShape element={element} editing={editing} />
    </g>
  );
});
