import type { ButtonHTMLAttributes, ComponentType } from "react";
import {
  Circle,
  Diamond,
  Eraser,
  Hand,
  Minus,
  MousePointer2,
  MoveUpRight,
  PaintBucket,
  Pencil,
  Pentagon,
  Redo2,
  Square,
  StickyNote,
  Trash,
  Triangle,
  Type,
  Undo2,
  type LucideProps,
} from "lucide-react";
import { COLORS } from "../constants";
import type { Color } from "../model";
import { cn } from "@/lib/utils";
import { PALETTE } from "./render";

export type Tool =
  | "select"
  | "hand"
  | "pen"
  | "line"
  | "arrow"
  | "rect"
  | "ellipse"
  | "diamond"
  | "triangle"
  | "polygon"
  | "text"
  | "note"
  | "eraser";

export interface Style {
  color: Color;
  size: 0 | 1 | 2;
  fill: boolean;
}

export const STROKE_WIDTHS = [2, 4, 8] as const;
export const TEXT_SIZES = [18, 28, 44] as const;

interface ToolSpec {
  tool: Tool;
  label: string;
  shortcut?: string;
  icon: ComponentType<LucideProps>;
}

export const TOOLS: readonly ToolSpec[] = [
  { tool: "select", label: "Select", shortcut: "V", icon: MousePointer2 },
  { tool: "hand", label: "Pan", shortcut: "H", icon: Hand },
  { tool: "pen", label: "Pen", shortcut: "P", icon: Pencil },
  { tool: "line", label: "Line", shortcut: "L", icon: Minus },
  { tool: "arrow", label: "Arrow", shortcut: "A", icon: MoveUpRight },
  { tool: "rect", label: "Rectangle", shortcut: "R", icon: Square },
  { tool: "ellipse", label: "Ellipse", shortcut: "O", icon: Circle },
  { tool: "diamond", label: "Diamond", shortcut: "D", icon: Diamond },
  { tool: "triangle", label: "Triangle", icon: Triangle },
  { tool: "polygon", label: "Polygon (click points, Enter to finish)", shortcut: "G", icon: Pentagon },
  { tool: "text", label: "Text", shortcut: "T", icon: Type },
  { tool: "note", label: "Sticky note", shortcut: "N", icon: StickyNote },
  { tool: "eraser", label: "Eraser", shortcut: "E", icon: Eraser },
];

export function ToolbarButton({
  label,
  active,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
        active && "bg-state-active text-foreground",
        className,
      )}
      {...props}
    />
  );
}

function Divider() {
  return <div className="mx-0.5 h-5 w-px shrink-0 bg-border" />;
}

export function Toolbar({
  tool,
  onTool,
  style,
  onStyle,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  hasSelection,
  onDelete,
}: {
  tool: Tool;
  onTool: (tool: Tool) => void;
  style: Style;
  onStyle: (patch: Partial<Style>) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  hasSelection: boolean;
  onDelete: () => void;
}) {
  return (
    <div
      className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-0.5 rounded-lg border border-border bg-popover p-1 shadow-md"
      onPointerDown={(event) => event.stopPropagation()}
    >
      {TOOLS.map(({ tool: value, label, shortcut, icon: ToolIcon }) => (
        <ToolbarButton
          key={value}
          label={shortcut ? `${label} — ${shortcut}` : label}
          active={tool === value}
          onClick={() => onTool(value)}
        >
          <ToolIcon className="size-4" />
        </ToolbarButton>
      ))}
      <Divider />
      {COLORS.map((color) => (
        <ToolbarButton
          key={color}
          label={`Color: ${color}`}
          active={style.color === color}
          onClick={() => onStyle({ color })}
        >
          <span
            className={cn(
              "size-3.5 rounded-full border border-border",
              color === "ink" && "bg-foreground",
            )}
            style={color === "ink" ? undefined : { backgroundColor: PALETTE[color] }}
          />
        </ToolbarButton>
      ))}
      <Divider />
      {STROKE_WIDTHS.map((width, index) => (
        <ToolbarButton
          key={width}
          label={["Small", "Medium", "Large"][index]!}
          active={style.size === index}
          onClick={() => onStyle({ size: index as Style["size"] })}
        >
          <span className="rounded-full bg-current" style={{ width: width + 2, height: width + 2 }} />
        </ToolbarButton>
      ))}
      <ToolbarButton label="Fill shapes" active={style.fill} onClick={() => onStyle({ fill: !style.fill })}>
        <PaintBucket className="size-4" />
      </ToolbarButton>
      <Divider />
      <ToolbarButton label="Undo — ⌘Z" disabled={!canUndo} onClick={onUndo}>
        <Undo2 className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="Redo — ⇧⌘Z" disabled={!canRedo} onClick={onRedo}>
        <Redo2 className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="Delete selection — ⌫" disabled={!hasSelection} onClick={onDelete}>
        <Trash className="size-4" />
      </ToolbarButton>
    </div>
  );
}
