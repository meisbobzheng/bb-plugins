import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import type { rpcContract } from "../server";
import { BOARDS_CHANGED, type BoardsChangedSignal } from "../constants";
import type { Board, Element, Point } from "../model";
import {
  FONT_FAMILY,
  LINE_HEIGHT,
  NOTE_FONT_SIZE,
  NOTE_PADDING,
  elementBox,
  fitToBox,
  hitTest,
  intersectsBox,
  normalizeBox,
  round,
  snapAngle,
  translate,
  unionBoxes,
  type Box,
} from "./geometry";
import { ElementView, PALETTE } from "./render";
import { renderSnapshot } from "./snapshot";
import {
  STROKE_WIDTHS,
  TEXT_SIZES,
  TOOLS,
  Toolbar,
  ToolbarButton,
  type Style,
  type Tool,
} from "./Toolbar";
import { useHistory } from "./useHistory";

const CLIENT_ID = Math.random().toString(36).slice(2, 12);
const SAVE_DELAY_MS = 700;
const HIT_TOLERANCE = 6;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const GRID = 24;
const NOTE_SIZE = { w: 200, h: 150 };
const DEFAULT_SHAPE = { w: 120, h: 80 };
const EMPTY_SELECTION: ReadonlySet<string> = new Set();
const pendingSaves = new Map<string, Promise<void>>();

export function waitForSave(boardId: string): Promise<void> {
  return pendingSaves.get(boardId) ?? Promise.resolve();
}

interface View {
  x: number;
  y: number;
  zoom: number;
}

type Gesture =
  | { kind: "pan"; client: Point; view: View }
  | { kind: "draw"; id: string; origin: Point; before: Element[] }
  | { kind: "move"; origin: Point; ids: ReadonlySet<string>; before: Element[] }
  | { kind: "resize"; id: string; anchor: Point; from: Box; before: Element[] }
  | { kind: "endpoint"; id: string; index: 0 | 1; before: Element[] }
  | { kind: "marquee"; origin: Point; base: ReadonlySet<string> }
  | { kind: "erase"; before: Element[] };

interface EditSession {
  id: string;
  before: Element[];
  created: boolean;
}

const SHAPE_TOOLS: Partial<Record<Tool, "rect" | "ellipse" | "diamond" | "triangle">> = {
  rect: "rect",
  ellipse: "ellipse",
  diamond: "diamond",
  triangle: "triangle",
};

function newId(): string {
  return Math.random().toString(36).slice(2, 12);
}

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

function topmostAt(elements: readonly Element[], point: Point, tolerance: number): Element | null {
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    if (hitTest(elements[index]!, point, tolerance)) return elements[index]!;
  }
  return null;
}

function constrainedBox(origin: Point, point: Point, square: boolean): Box {
  if (!square) return normalizeBox(origin, point);
  const dx = point[0] - origin[0];
  const dy = point[1] - origin[1];
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return normalizeBox(origin, [origin[0] + Math.sign(dx || 1) * side, origin[1] + Math.sign(dy || 1) * side]);
}

function corners({ x, y, w, h }: Box): Point[] {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

function restyle(element: Element, patch: Partial<Style>): Element {
  let next = patch.color === undefined ? element : { ...element, color: patch.color };
  if (patch.size !== undefined) {
    if (next.type === "text") next = { ...next, size: TEXT_SIZES[patch.size] };
    else if (next.type !== "note") next = { ...next, width: STROKE_WIDTHS[patch.size] };
  }
  if (patch.fill !== undefined && (next.type === "shape" || next.type === "polygon")) {
    next = { ...next, fill: patch.fill };
  }
  return next;
}

function withoutEmptyText(elements: Element[]): Element[] {
  return elements.filter((element) => element.type !== "text" || element.text.trim() !== "");
}

function fitView(elements: readonly Element[], width: number, height: number): View {
  const bounds = unionBoxes(elements.map(elementBox));
  if (bounds === null || width === 0 || height === 0) return { x: 0, y: 0, zoom: 1 };
  const zoom = clampZoom(Math.min(1, (width - 96) / bounds.w, (height - 120) / bounds.h));
  return {
    x: width / 2 - (bounds.x + bounds.w / 2) * zoom,
    y: height / 2 - (bounds.y + bounds.h / 2) * zoom + 20,
    zoom,
  };
}

export function Editor({ board }: { board: Board }) {
  const rpc = useRpc<typeof rpcContract>();
  const { elements, canUndo, canRedo, replace, commit, apply, undo, redo } = useHistory(board.elements);
  const [tool, setTool] = useState<Tool>("select");
  const [style, setStyle] = useState<Style>({ color: "ink", size: 0, fill: false });
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1 });
  const [selection, setSelection] = useState<ReadonlySet<string>>(EMPTY_SELECTION);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [polygonDraft, setPolygonDraft] = useState<Point[] | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [editing, setEditing] = useState<EditSession | null>(null);
  const [panning, setPanning] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const contentNodeRef = useRef<SVGGElement | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const elementsRef = useRef(elements);
  const viewRef = useRef(view);
  const editingRef = useRef(editing);
  const savedRef = useRef<Element[]>(board.elements);
  const gridId = `scratchpad-grid-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  useLayoutEffect(() => {
    elementsRef.current = elements;
    viewRef.current = view;
    editingRef.current = editing;
  });

  useLayoutEffect(() => {
    const rect = svgRef.current?.getBoundingClientRect();
    setView(fitView(board.elements, rect?.width ?? 0, rect?.height ?? 0));
    containerRef.current?.focus({ preventScroll: true });
  }, [board.elements]);

  const save = useCallback(() => {
    const current = elementsRef.current;
    if (current === savedRef.current) return;
    savedRef.current = current;
    const persisted = withoutEmptyText(current);
    const node = contentNodeRef.current;
    const saving = (async () => {
      await pendingSaves.get(board.id);
      const snapshot = node === null ? null : await renderSnapshot(node, persisted).catch(() => null);
      await rpc.call("board_save", { id: board.id, elements: persisted, snapshot, clientId: CLIENT_ID });
    })().catch((cause: unknown) => {
      if (savedRef.current === current) savedRef.current = [];
      toast.error(`Scratchpad: could not save "${board.name}"`, {
        description: cause instanceof Error ? cause.message : String(cause),
      });
    });
    pendingSaves.set(board.id, saving);
    void saving.finally(() => {
      if (pendingSaves.get(board.id) === saving) pendingSaves.delete(board.id);
    });
  }, [rpc, board.id, board.name]);

  useEffect(() => {
    if (elements === savedRef.current || editing !== null) return;
    const timer = setTimeout(save, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [elements, editing, save]);

  const saveRef = useRef(save);
  useLayoutEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => () => saveRef.current(), []);

  useRealtime(BOARDS_CHANGED, (payload) => {
    const signal = payload as BoardsChangedSignal;
    if (signal.boardId !== board.id || signal.clientId === null || signal.clientId === CLIENT_ID) return;
    if (elementsRef.current !== savedRef.current || gestureRef.current || editingRef.current) return;
    rpc.call("board_get", { id: board.id }).then(({ board: next }) => {
      if (next === null || elementsRef.current !== savedRef.current) return;
      savedRef.current = next.elements;
      replace(() => next.elements);
    }, () => undefined);
  });

  const toWorld = useCallback((clientX: number, clientY: number): Point => {
    const rect = svgRef.current!.getBoundingClientRect();
    const { x, y, zoom } = viewRef.current;
    return [round((clientX - rect.left - x) / zoom), round((clientY - rect.top - y) / zoom)];
  }, []);

  const zoomAt = useCallback((factor: number, screen?: Point) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const [sx, sy] = screen ?? [rect.width / 2, rect.height / 2];
    setView((current) => {
      const zoom = clampZoom(current.zoom * factor);
      const wx = (sx - current.x) / current.zoom;
      const wy = (sy - current.y) / current.zoom;
      return { x: sx - wx * zoom, y: sy - wy * zoom, zoom };
    });
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const rect = svg.getBoundingClientRect();
        zoomAt(Math.exp(-event.deltaY * 0.01), [event.clientX - rect.left, event.clientY - rect.top]);
      } else {
        setView((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
      }
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const updateElement = useCallback(
    (id: string, update: (element: Element) => Element) => {
      replace((current) => current.map((element) => (element.id === id ? update(element) : element)));
    },
    [replace],
  );

  const startEditing = useCallback((session: EditSession) => {
    editingRef.current = session;
    setEditing(session);
    setSelection(new Set([session.id]));
  }, []);

  const finishEditing = useCallback(() => {
    const session = editingRef.current;
    if (session === null) return;
    editingRef.current = null;
    setEditing(null);
    const element = elementsRef.current.find((candidate) => candidate.id === session.id);
    if (element?.type === "text" && element.text.trim() === "") {
      setSelection(EMPTY_SELECTION);
      if (session.created) {
        replace(() => session.before);
        return;
      }
      replace((current) => current.filter((candidate) => candidate.id !== session.id));
    }
    commit(session.before);
    containerRef.current?.focus({ preventScroll: true });
  }, [replace, commit]);

  const finishPolygon = useCallback(() => {
    setPolygonDraft((draft) => {
      if (draft === null) return null;
      const tolerance = 4 / viewRef.current.zoom;
      const points = draft.filter(
        (point, index) =>
          index === 0 || Math.hypot(point[0] - draft[index - 1]![0], point[1] - draft[index - 1]![1]) > tolerance,
      );
      if (points.length >= 3) {
        apply((current) => [
          ...current,
          {
            id: newId(),
            type: "polygon",
            points,
            color: style.color,
            width: STROKE_WIDTHS[style.size],
            fill: style.fill,
          },
        ]);
      }
      return null;
    });
  }, [apply, style]);

  const changeTool = useCallback(
    (next: Tool) => {
      finishPolygon();
      setTool(next);
      if (next !== "select") setSelection(EMPTY_SELECTION);
    },
    [finishPolygon],
  );

  const changeStyle = useCallback(
    (patch: Partial<Style>) => {
      setStyle((current) => ({ ...current, ...patch }));
      if (selection.size === 0) return;
      apply((current) => current.map((element) => (selection.has(element.id) ? restyle(element, patch) : element)));
    },
    [apply, selection],
  );

  const deleteSelection = useCallback(() => {
    if (selection.size === 0) return;
    apply((current) => current.filter((element) => !selection.has(element.id)));
    setSelection(EMPTY_SELECTION);
  }, [apply, selection]);

  const duplicateSelection = useCallback(() => {
    if (selection.size === 0) return;
    const copies = elementsRef.current
      .filter((element) => selection.has(element.id))
      .map((element) => ({ ...translate(element, GRID, GRID), id: newId() }));
    apply((current) => [...current, ...copies]);
    setSelection(new Set(copies.map((copy) => copy.id)));
  }, [apply, selection]);

  const nudgeSelection = useCallback(
    (dx: number, dy: number) => {
      apply((current) =>
        current.map((element) => (selection.has(element.id) ? translate(element, dx, dy) : element)),
      );
    },
    [apply, selection],
  );

  const capture = (pointerId: number) => svgRef.current?.setPointerCapture(pointerId);

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (editingRef.current !== null) {
      finishEditing();
      return;
    }
    containerRef.current?.focus({ preventScroll: true });
    if (event.button === 1 || (event.button === 0 && (tool === "hand" || spaceHeld))) {
      capture(event.pointerId);
      gestureRef.current = { kind: "pan", client: [event.clientX, event.clientY], view: viewRef.current };
      setPanning(true);
      return;
    }
    if (event.button !== 0) return;
    const point = toWorld(event.clientX, event.clientY);
    const before = elementsRef.current;
    const tolerance = HIT_TOLERANCE / viewRef.current.zoom;
    const base = { color: style.color, width: STROKE_WIDTHS[style.size] };

    const startDraw = (element: Element) => {
      capture(event.pointerId);
      replace((current) => [...current, element]);
      gestureRef.current = { kind: "draw", id: element.id, origin: point, before };
    };

    const shapeKind = SHAPE_TOOLS[tool];
    if (shapeKind !== undefined) {
      startDraw({ id: newId(), type: "shape", kind: shapeKind, x: point[0], y: point[1], w: 0, h: 0, fill: style.fill, ...base });
      return;
    }
    switch (tool) {
      case "select": {
        const hit = topmostAt(before, point, tolerance);
        if (hit === null) {
          capture(event.pointerId);
          const kept = event.shiftKey ? selection : EMPTY_SELECTION;
          setSelection(kept);
          gestureRef.current = { kind: "marquee", origin: point, base: kept };
          return;
        }
        let next = selection;
        if (event.shiftKey) {
          const toggled = new Set(selection);
          if (toggled.delete(hit.id)) {
            setSelection(toggled);
            return;
          }
          next = toggled.add(hit.id);
        } else if (!selection.has(hit.id)) {
          next = new Set([hit.id]);
        }
        setSelection(next);
        capture(event.pointerId);
        gestureRef.current = { kind: "move", origin: point, ids: next, before };
        return;
      }
      case "eraser":
        capture(event.pointerId);
        gestureRef.current = { kind: "erase", before };
        replace((current) => current.filter((element) => !hitTest(element, point, tolerance)));
        return;
      case "pen":
        startDraw({ id: newId(), type: "pen", points: [point], ...base });
        return;
      case "line":
      case "arrow":
        startDraw({ id: newId(), type: "line", points: [point, point], arrow: tool === "arrow", ...base });
        return;
      case "polygon": {
        const first = polygonDraft?.[0];
        if (
          polygonDraft !== null &&
          polygonDraft.length >= 3 &&
          first !== undefined &&
          Math.hypot(point[0] - first[0], point[1] - first[1]) <= tolerance * 2
        ) {
          finishPolygon();
          return;
        }
        setPolygonDraft((draft) => [...(draft ?? []), point]);
        return;
      }
      case "text": {
        const size = TEXT_SIZES[style.size];
        const element: Element = {
          id: newId(),
          type: "text",
          x: point[0],
          y: round(point[1] - (size * LINE_HEIGHT) / 2),
          text: "",
          color: style.color,
          size,
        };
        event.preventDefault();
        replace((current) => [...current, element]);
        startEditing({ id: element.id, before, created: true });
        return;
      }
      case "note": {
        const element: Element = {
          id: newId(),
          type: "note",
          x: point[0] - NOTE_SIZE.w / 2,
          y: point[1] - NOTE_SIZE.h / 2,
          ...NOTE_SIZE,
          text: "",
          color: style.color === "ink" ? "yellow" : style.color,
        };
        event.preventDefault();
        replace((current) => [...current, element]);
        startEditing({ id: element.id, before, created: true });
        return;
      }
    }
  };

  const onHandlePointerDown = (event: ReactPointerEvent, gesture: Gesture) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    capture(event.pointerId);
    gestureRef.current = gesture;
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const gesture = gestureRef.current;
    if (gesture?.kind === "pan") {
      setView({
        ...gesture.view,
        x: gesture.view.x + event.clientX - gesture.client[0],
        y: gesture.view.y + event.clientY - gesture.client[1],
      });
      return;
    }
    const point = toWorld(event.clientX, event.clientY);
    if (gesture === null) {
      if (polygonDraft !== null) setCursor(point);
      return;
    }
    switch (gesture.kind) {
      case "draw":
        updateElement(gesture.id, (element) => {
          switch (element.type) {
            case "pen": {
              const last = element.points[element.points.length - 1]!;
              if (Math.hypot(point[0] - last[0], point[1] - last[1]) < 1.5 / viewRef.current.zoom) return element;
              return { ...element, points: [...element.points, point] };
            }
            case "line":
              return { ...element, points: [gesture.origin, event.shiftKey ? snapAngle(gesture.origin, point) : point] };
            case "shape":
              return { ...element, ...constrainedBox(gesture.origin, point, event.shiftKey) };
            default:
              return element;
          }
        });
        return;
      case "move": {
        const dx = point[0] - gesture.origin[0];
        const dy = point[1] - gesture.origin[1];
        replace(() =>
          gesture.before.map((element) => (gesture.ids.has(element.id) ? translate(element, dx, dy) : element)),
        );
        return;
      }
      case "resize": {
        const original = gesture.before.find((element) => element.id === gesture.id);
        if (original === undefined) return;
        const square = event.shiftKey || original.type === "text";
        let target = normalizeBox(gesture.anchor, point);
        if (square && gesture.from.w > 0 && gesture.from.h > 0) {
          const scale = Math.max(target.w / gesture.from.w, target.h / gesture.from.h);
          const w = gesture.from.w * scale;
          const h = gesture.from.h * scale;
          target = {
            x: point[0] < gesture.anchor[0] ? gesture.anchor[0] - w : gesture.anchor[0],
            y: point[1] < gesture.anchor[1] ? gesture.anchor[1] - h : gesture.anchor[1],
            w,
            h,
          };
        }
        replace(() =>
          gesture.before.map((element) => (element.id === gesture.id ? fitToBox(element, gesture.from, target) : element)),
        );
        return;
      }
      case "endpoint":
        updateElement(gesture.id, (element) => {
          if (element.type !== "line") return element;
          const other = element.points[gesture.index === 0 ? 1 : 0];
          const moved = event.shiftKey ? snapAngle(other, point) : point;
          return { ...element, points: gesture.index === 0 ? [moved, other] : [other, moved] };
        });
        return;
      case "marquee": {
        const area = normalizeBox(gesture.origin, point);
        setMarquee(area);
        const next = new Set(gesture.base);
        for (const element of elementsRef.current) if (intersectsBox(element, area)) next.add(element.id);
        setSelection(next);
        return;
      }
      case "erase": {
        const tolerance = HIT_TOLERANCE / viewRef.current.zoom;
        replace((current) => {
          const kept = current.filter((element) => !hitTest(element, point, tolerance));
          return kept.length === current.length ? current : kept;
        });
        return;
      }
    }
  };

  const onPointerUp = () => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    setPanning(false);
    setMarquee(null);
    if (gesture === null || gesture.kind === "pan" || gesture.kind === "marquee") return;
    if (gesture.kind === "draw") {
      const drawn = elementsRef.current.find((element) => element.id === gesture.id);
      const zoom = viewRef.current.zoom;
      if (drawn?.type === "line") {
        const [[x1, y1], [x2, y2]] = drawn.points;
        if (Math.hypot(x2 - x1, y2 - y1) < 3 / zoom) {
          replace(() => gesture.before);
          return;
        }
      }
      if (drawn?.type === "shape" && drawn.w < 4 / zoom && drawn.h < 4 / zoom) {
        const [x, y] = gesture.origin;
        updateElement(gesture.id, (element) => ({
          ...element,
          x: x - DEFAULT_SHAPE.w / 2,
          y: y - DEFAULT_SHAPE.h / 2,
          ...DEFAULT_SHAPE,
        }));
      }
    }
    commit(gesture.before);
  };

  const onDoubleClick = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (tool === "polygon") {
      finishPolygon();
      return;
    }
    if (tool !== "select") return;
    const point = toWorld(event.clientX, event.clientY);
    const hit = topmostAt(elementsRef.current, point, HIT_TOLERANCE / viewRef.current.zoom);
    if (hit?.type === "text" || hit?.type === "note") {
      startEditing({ id: hit.id, before: elementsRef.current, created: false });
      return;
    }
    if (hit !== null) return;
    const size = TEXT_SIZES[style.size];
    const element: Element = {
      id: newId(),
      type: "text",
      x: point[0],
      y: round(point[1] - (size * LINE_HEIGHT) / 2),
      text: "",
      color: style.color,
      size,
    };
    const before = elementsRef.current;
    replace((current) => [...current, element]);
    startEditing({ id: element.id, before, created: true });
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (mod && key === "z") {
      handled();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && key === "y") return void (handled(), redo());
    if (mod && key === "a") {
      handled();
      setTool("select");
      setSelection(new Set(elementsRef.current.map((element) => element.id)));
      return;
    }
    if (mod && key === "d") return void (handled(), duplicateSelection());
    if (key === "backspace" || key === "delete") return void (handled(), deleteSelection());
    if (key === "escape") {
      if (polygonDraft !== null) return void (handled(), setPolygonDraft(null));
      if (selection.size > 0) return void (handled(), setSelection(EMPTY_SELECTION));
      return;
    }
    if (key === "enter" && polygonDraft !== null) return void (handled(), finishPolygon());
    if (key === " ") return void (handled(), setSpaceHeld(true));
    const arrows: Record<string, Point> = {
      arrowleft: [-1, 0],
      arrowright: [1, 0],
      arrowup: [0, -1],
      arrowdown: [0, 1],
    };
    const arrow = arrows[key];
    if (arrow !== undefined && selection.size > 0) {
      handled();
      const step = event.shiftKey ? 10 : 1;
      nudgeSelection(arrow[0] * step, arrow[1] * step);
      return;
    }
    if (mod || event.altKey) return;
    const spec = TOOLS.find((candidate) => candidate.shortcut?.toLowerCase() === key);
    if (spec !== undefined) {
      handled();
      changeTool(spec.tool);
    }
  };

  const zoom = view.zoom;
  const transform = `translate(${view.x} ${view.y}) scale(${zoom})`;
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const selected = [...selection].flatMap((id) => elementsById.get(id) ?? []);
  const single = selected.length === 1 && editing === null ? selected[0]! : null;
  const editingElement = editing === null ? undefined : elementsById.get(editing.id);
  const handleSize = 8 / zoom;
  const cursorStyle =
    panning ? "grabbing" : tool === "hand" || spaceHeld ? "grab" : tool === "select" ? "default" : tool === "text" ? "text" : "crosshair";

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      data-scratchpad-canvas=""
      className="relative h-full min-h-0 w-full overflow-hidden text-foreground outline-none"
      onKeyDown={onKeyDown}
      onKeyUp={(event) => {
        if (event.key === " ") setSpaceHeld(false);
      }}
      onBlur={() => setSpaceHeld(false)}
    >
      <svg
        ref={svgRef}
        className="absolute inset-0 size-full touch-none select-none"
        style={{ cursor: cursorStyle }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setCursor(null)}
        onDoubleClick={onDoubleClick}
      >
        {zoom >= 0.3 ? (
          <>
            <defs>
              <pattern
                id={gridId}
                width={GRID * zoom}
                height={GRID * zoom}
                patternUnits="userSpaceOnUse"
                patternTransform={`translate(${view.x} ${view.y})`}
              >
                <circle cx={1} cy={1} r={1} fill="currentColor" fillOpacity={0.14} />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill={`url(#${gridId})`} />
          </>
        ) : null}
        <g
          ref={(node) => {
            if (node !== null) contentNodeRef.current = node;
          }}
          transform={transform}
        >
          {elements.map((element) => (
            <ElementView key={element.id} element={element} editing={editing?.id === element.id} />
          ))}
        </g>
        <g transform={transform} fill="none" stroke="var(--ring, #0090ff)" strokeWidth={1 / zoom}>
          {selected.map((element) => {
            if (element.type === "line" && single !== null) return null;
            const box = elementBox(element);
            const pad = 4 / zoom;
            return (
              <rect
                key={element.id}
                x={box.x - pad}
                y={box.y - pad}
                width={box.w + pad * 2}
                height={box.h + pad * 2}
                strokeDasharray={`${4 / zoom} ${3 / zoom}`}
              />
            );
          })}
          {single?.type === "line"
            ? single.points.map(([x, y], index) => (
                <circle
                  key={index}
                  cx={x}
                  cy={y}
                  r={handleSize / 1.6}
                  fill="var(--background, #fff)"
                  style={{ cursor: "move" }}
                  onPointerDown={(event) =>
                    onHandlePointerDown(event, {
                      kind: "endpoint",
                      id: single.id,
                      index: index as 0 | 1,
                      before: elementsRef.current,
                    })
                  }
                />
              ))
            : null}
          {single !== null && single.type !== "line"
            ? corners(elementBox(single)).map(([x, y], index, all) => (
                <rect
                  key={index}
                  x={x - handleSize / 2}
                  y={y - handleSize / 2}
                  width={handleSize}
                  height={handleSize}
                  rx={2 / zoom}
                  fill="var(--background, #fff)"
                  style={{ cursor: index % 2 === 0 ? "nwse-resize" : "nesw-resize" }}
                  onPointerDown={(event) =>
                    onHandlePointerDown(event, {
                      kind: "resize",
                      id: single.id,
                      anchor: all[(index + 2) % 4]!,
                      from: elementBox(single),
                      before: elementsRef.current,
                    })
                  }
                />
              ))
            : null}
          {polygonDraft !== null ? (
            <polyline
              points={[...polygonDraft, ...(cursor ? [cursor] : [])].map(([x, y]) => `${x},${y}`).join(" ")}
              stroke={PALETTE[style.color]}
              strokeWidth={STROKE_WIDTHS[style.size]}
              strokeDasharray={`${6 / zoom} ${4 / zoom}`}
              strokeLinejoin="round"
            />
          ) : null}
          {marquee !== null ? (
            <rect x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} fill="currentColor" fillOpacity={0.05} />
          ) : null}
        </g>
      </svg>

      {editingElement?.type === "text" || editingElement?.type === "note" ? (
        <textarea
          autoFocus
          value={editingElement.text}
          spellCheck={false}
          aria-label={editingElement.type === "note" ? "Sticky note text" : "Text"}
          className="absolute m-0 resize-none overflow-hidden border-none bg-transparent p-0 outline-none"
          style={
            {
              fieldSizing: "content",
              fontFamily: FONT_FAMILY,
              lineHeight: LINE_HEIGHT,
              ...(editingElement.type === "note"
                ? {
                    left: (editingElement.x + NOTE_PADDING) * zoom + view.x,
                    top: (editingElement.y + NOTE_PADDING) * zoom + view.y,
                    width: (editingElement.w - NOTE_PADDING * 2) * zoom,
                    fontSize: NOTE_FONT_SIZE * zoom,
                  }
                : {
                    left: editingElement.x * zoom + view.x,
                    top: editingElement.y * zoom + view.y,
                    minWidth: editingElement.size * zoom,
                    fontSize: editingElement.size * zoom,
                    color: PALETTE[editingElement.color],
                    whiteSpace: "pre",
                  }),
            } as CSSProperties
          }
          onFocus={(event) => {
            const end = event.currentTarget.value.length;
            event.currentTarget.setSelectionRange(end, end);
          }}
          onChange={(event) => {
            const text = event.target.value;
            updateElement(editingElement.id, (element) =>
              element.type === "text" || element.type === "note" ? { ...element, text } : element,
            );
          }}
          onBlur={finishEditing}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape" || (event.key === "Enter" && (event.metaKey || event.ctrlKey))) {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
      ) : null}

      <div className="pointer-events-none absolute inset-x-2 top-2 flex justify-center">
        <Toolbar
          tool={tool}
          onTool={changeTool}
          style={style}
          onStyle={changeStyle}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={undo}
          onRedo={redo}
          hasSelection={selection.size > 0}
          onDelete={deleteSelection}
        />
      </div>

      {elements.length === 0 && editing === null ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">
          <p>
            Draw, type, or drop a sticky note. Double-click to add text.
            <br />
            Type <kbd className="rounded border border-border px-1 font-mono text-xs">@</kbd> in any thread's
            composer to reference this board.
          </p>
        </div>
      ) : null}

      <div
        className="absolute bottom-2 right-2 flex items-center gap-0.5 rounded-lg border border-border bg-popover p-0.5 shadow-sm"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <ToolbarButton label="Zoom out" onClick={() => zoomAt(1 / 1.25)}>
          <Minus className="size-3.5" />
        </ToolbarButton>
        <button
          type="button"
          title="Fit board to window"
          className="h-7 min-w-12 rounded-md px-1 text-xs tabular-nums text-muted-foreground hover:bg-state-hover hover:text-foreground"
          onClick={() => {
            const rect = svgRef.current?.getBoundingClientRect();
            setView(fitView(elementsRef.current, rect?.width ?? 0, rect?.height ?? 0));
          }}
        >
          {Math.round(zoom * 100)}%
        </button>
        <ToolbarButton label="Zoom in" onClick={() => zoomAt(1.25)}>
          <Plus className="size-3.5" />
        </ToolbarButton>
      </div>
    </div>
  );
}
