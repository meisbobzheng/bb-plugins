import { useEffect, type RefObject } from "react";
import { LIMITS, isKind, type Kind } from "../library";

export interface Filters {
  query: string;
  kind: Kind | null;
  tags: string[];
  thisThread: boolean;
}

export const EMPTY_FILTERS: Filters = { query: "", kind: null, tags: [], thisThread: false };

const ENTRY_ID = /^lib_[a-z0-9]{8}$/;
const SCROLL_MEMORY = 50;
const RESTORE_WINDOW_MS = 3000;
let visiblePages = 0;

export function recent<T>(limit: number) {
  const items = new Map<string, T>();
  return {
    get: (key: string) => items.get(key),
    set(key: string, value: T): void {
      items.delete(key);
      items.set(key, value);
      if (items.size > limit) items.delete(items.keys().next().value!);
    },
  };
}

const scrollPositions = recent<number>(SCROLL_MEMORY);

type Area = "local" | "session";

function read(area: Area, key: string): unknown {
  try {
    const raw = (area === "local" ? window.localStorage : window.sessionStorage).getItem(key);
    return raw === null ? undefined : (JSON.parse(raw) as unknown);
  } catch {
    return undefined;
  }
}

function write(area: Area, key: string, value: unknown): void {
  try {
    (area === "local" ? window.localStorage : window.sessionStorage).setItem(key, JSON.stringify(value));
  } catch {
    return;
  }
}

export function lastEntry(pluginId: string): string | null {
  const value = read("local", `${pluginId}:last-entry`);
  return typeof value === "string" && ENTRY_ID.test(value) ? value : null;
}

export function rememberEntry(pluginId: string, id: string | null): void {
  write("local", `${pluginId}:last-entry`, id);
}

export function lastFilters(pluginId: string): Filters {
  const value = read("session", `${pluginId}:filters`);
  if (typeof value !== "object" || value === null) return EMPTY_FILTERS;
  const { query, kind, tags, thisThread } = value as Record<string, unknown>;
  return {
    query: typeof query === "string" ? query.slice(0, LIMITS.query) : "",
    kind: typeof kind === "string" && isKind(kind) ? kind : null,
    tags: Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === "string").slice(0, LIMITS.tagFilters) : [],
    thisThread: thisThread === true,
  };
}

export function rememberFilters(pluginId: string, filters: Filters): void {
  write("session", `${pluginId}:filters`, filters);
}

export function markLibraryVisible(): () => void {
  visiblePages += 1;
  return () => {
    visiblePages -= 1;
  };
}

export function isLibraryVisible(): boolean {
  return visiblePages > 0;
}

export function useScrollMemory(container: RefObject<HTMLElement | null>, id: string | null, ready: boolean): void {
  useEffect(() => {
    const element = container.current;
    if (element === null || id === null || !ready) return;
    const target = scrollPositions.get(id) ?? 0;
    let restoring = true;
    const finish = () => {
      restoring = false;
    };
    const apply = () => {
      if (!restoring) return;
      element.scrollTop = target;
      if (Math.abs(element.scrollTop - target) < 2) finish();
    };
    const onScroll = () => {
      if (!restoring) scrollPositions.set(id, element.scrollTop);
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(apply);
    for (const child of element.children) observer?.observe(child);
    const timer = setTimeout(finish, RESTORE_WINDOW_MS);
    const interrupts = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
    interrupts.forEach((type) => element.addEventListener(type, finish, { passive: true }));
    element.addEventListener("scroll", onScroll, { passive: true });
    apply();
    return () => {
      observer?.disconnect();
      clearTimeout(timer);
      interrupts.forEach((type) => element.removeEventListener(type, finish));
      element.removeEventListener("scroll", onScroll);
    };
  }, [container, id, ready]);
}
