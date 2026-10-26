import { useSyncExternalStore } from "react";
import type { Place } from "./session";

interface FloatingState {
  open: boolean;
  place: Place | null;
}

let state: FloatingState = { open: false, place: null };
const listeners = new Set<() => void>();

function update(patch: Partial<FloatingState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const floating = {
  get: () => state,
  toggle: (place: Place | null = null) =>
    update(state.open ? { open: false } : { open: true, place }),
  hide: () => update({ open: false }),
};

export function useFloating(): FloatingState {
  return useSyncExternalStore(subscribe, floating.get);
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const MIN_SIZE = { width: 360, height: 200 };

export function defaultRect(viewport: { width: number; height: number }): Rect {
  const width = Math.min(viewport.width * 0.8, 1100);
  const height = Math.min(viewport.height * 0.7, 640);
  return {
    left: Math.round((viewport.width - width) / 2),
    top: Math.round(viewport.height * 0.12),
    width: Math.round(width),
    height: Math.round(height),
  };
}

export function clampRect(
  rect: Rect,
  viewport: { width: number; height: number },
): Rect {
  const width = Math.min(Math.max(rect.width, MIN_SIZE.width), viewport.width);
  const height = Math.min(Math.max(rect.height, MIN_SIZE.height), viewport.height);
  return {
    width,
    height,
    left: Math.min(Math.max(rect.left, 0), viewport.width - width),
    top: Math.min(Math.max(rect.top, 0), viewport.height - height),
  };
}

export function parseRect(value: string | null): Rect | null {
  try {
    const rect = JSON.parse(value ?? "null") as Partial<Rect> | null;
    const fields = [rect?.left, rect?.top, rect?.width, rect?.height];
    return fields.every((field) => typeof field === "number" && Number.isFinite(field))
      ? (rect as Rect)
      : null;
  } catch {
    return null;
  }
}
