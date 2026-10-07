import { useEffect, useMemo, useRef, type RefObject } from "react";
import { DIFFS_TAG_NAME } from "@pierre/diffs";
import type { Side } from "../contract";
import type { DiffStyle } from "../highlight";

const IDENTIFIER = /[A-Za-z_$][\w$]*/g;

export interface Identifier {
  text: string;
  offset: number;
}

function textNodeOf(element: HTMLElement): Text | null {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  return walker.nextNode() as Text | null;
}

export function identifierAt(tokenElement: HTMLElement, tokenText: string, clientX: number): Identifier | null {
  const candidates = [...tokenText.matchAll(IDENTIFIER)].map((match) => ({ text: match[0], offset: match.index }));
  if (candidates.length <= 1) return candidates[0] ?? null;
  const node = textNodeOf(tokenElement);
  if (node === null) return candidates[0] ?? null;
  const range = document.createRange();
  for (const candidate of candidates) {
    range.setStart(node, candidate.offset);
    range.setEnd(node, candidate.offset + candidate.text.length);
    const box = range.getBoundingClientRect();
    if (clientX >= box.left && clientX <= box.right) return candidate;
  }
  return null;
}

export function isModifierClick(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return navigator.platform.toLowerCase().includes("mac") ? event.metaKey : event.ctrlKey;
}

function lineSelector(side: Side | null, line: number, diffStyle: DiffStyle | null): string {
  if (side === null) return `[data-line="${line}"]`;
  if (diffStyle === "split") return `[data-${side}] [data-line="${line}"]`;
  const type = side === "deletions" ? '[data-line-type="change-deletion"]' : ':not([data-line-type="change-deletion"])';
  return `[data-line="${line}"]${type}`;
}

export function findLine(host: HTMLElement | null, side: Side | null, line: number, diffStyle: DiffStyle | null): HTMLElement | null {
  const root = host?.querySelector(DIFFS_TAG_NAME)?.shadowRoot;
  return root?.querySelector<HTMLElement>(lineSelector(side, line, diffStyle)) ?? null;
}

export interface LineFocus {
  side: Side | null;
  line: number;
  seq: number;
}

export function useScrollToLine(
  host: RefObject<HTMLElement | null>,
  focus: LineFocus | null,
  layout: string,
  diffStyle: DiffStyle | null,
  onMissing: () => void,
): void {
  const missing = useRef(onMissing);
  missing.current = onMissing;
  useEffect(() => {
    if (focus === null) return;
    let frame = 0;
    let attempts = 0;
    const tick = () => {
      const element = findLine(host.current, focus.side, focus.line, diffStyle);
      if (element !== null) {
        element.scrollIntoView({ block: "center" });
        return;
      }
      if (++attempts < 90) frame = requestAnimationFrame(tick);
      else missing.current();
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [focus, layout, diffStyle, host]);
}

function underline(element: HTMLElement, on: boolean): void {
  element.style.textDecoration = on ? "underline" : "";
  element.style.cursor = on ? "pointer" : "";
}

export function useModifierUnderline(): {
  enter(element: HTMLElement, modifier: boolean): void;
  leave(element: HTMLElement): void;
} {
  const hovered = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const sync = (event: KeyboardEvent) => {
      if (hovered.current !== null) underline(hovered.current, isModifierClick(event));
    };
    window.addEventListener("keydown", sync);
    window.addEventListener("keyup", sync);
    return () => {
      window.removeEventListener("keydown", sync);
      window.removeEventListener("keyup", sync);
    };
  }, []);
  return useMemo(
    () => ({
      enter(element: HTMLElement, modifier: boolean) {
        hovered.current = element;
        underline(element, modifier);
      },
      leave(element: HTMLElement) {
        underline(element, false);
        if (hovered.current === element) hovered.current = null;
      },
    }),
    [],
  );
}
