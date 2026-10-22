import { useCallback, useEffect, useRef, useState } from "react";

const MEMORY_LIMIT = 200;
const STORAGE_PREFIX = "pr-board:cache:v1:";

interface Entry<T> {
  value: T;
  at: number;
}

const memory = new Map<string, Entry<unknown>>();

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function remember<T>(key: string, entry: Entry<T>, persist: boolean): void {
  memory.delete(key);
  memory.set(key, entry);
  if (memory.size > MEMORY_LIMIT) memory.delete(memory.keys().next().value!);
  if (!persist) return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(entry));
  } catch {
    return;
  }
}

function recall<T>(key: string, persist: boolean): Entry<T> | null {
  const hit = memory.get(key);
  if (hit !== undefined) return hit as Entry<T>;
  if (!persist) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
    if (raw === null) return null;
    const entry = JSON.parse(raw) as Entry<T>;
    memory.set(key, entry);
    return entry;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function reuseEqual<T>(previous: unknown, next: T): T {
  if (Object.is(previous, next)) return next;
  if (Array.isArray(previous) && Array.isArray(next)) {
    const items = next.map((item, index) => reuseEqual(previous[index], item));
    return (items.length === previous.length && items.every((item, index) => item === previous[index]) ? previous : items) as T;
  }
  if (isRecord(previous) && isRecord(next)) {
    const keys = Object.keys(next);
    const merged = Object.fromEntries(keys.map((key) => [key, reuseEqual(previous[key], next[key])]));
    return (keys.length === Object.keys(previous).length && keys.every((key) => merged[key] === previous[key]) ? previous : merged) as T;
  }
  return next;
}

const loading = new Map<string, Promise<unknown>>();

function shared<T>(key: string, load: () => Promise<T>): Promise<T> {
  const running = loading.get(key);
  if (running !== undefined) return running as Promise<T>;
  const next = load().finally(() => loading.delete(key));
  loading.set(key, next);
  return next;
}

export function prefetch<T>(key: string, load: () => Promise<T>): void {
  if (recall(key, false) !== null) return;
  shared(key, load).then(
    (value) => remember(key, { value, at: Date.now() }, false),
    () => undefined,
  );
}

export interface Cached<T> {
  value: T | null;
  refreshing: boolean;
  error: string | null;
  reload(): void;
}

export function useCached<T>(
  key: string,
  load: () => Promise<T>,
  { persist = false, immutable = false }: { persist?: boolean; immutable?: boolean } = {},
): Cached<T> {
  const [state, setState] = useState<{ key: string; entry: Entry<T> | null; error: string | null }>(() => ({
    key,
    entry: recall<T>(key, persist),
    error: null,
  }));
  const [refreshing, setRefreshing] = useState(false);
  const [generation, setGeneration] = useState(0);
  const latest = useRef(load);
  latest.current = load;

  useEffect(() => {
    const cached = recall<T>(key, persist);
    if (immutable && cached !== null) {
      setState({ key, entry: cached, error: null });
      return;
    }
    let live = true;
    setRefreshing(true);
    (immutable ? shared(key, () => latest.current()) : latest.current())
      .then(
        (value) => {
          if (!live) return;
          const entry = { value: reuseEqual(recall<T>(key, persist)?.value, value), at: Date.now() };
          remember(key, entry, persist);
          setState({ key, entry, error: null });
        },
        (error: unknown) => {
          if (live) setState({ key, entry: recall<T>(key, persist), error: errorMessage(error) });
        },
      )
      .finally(() => {
        if (live) setRefreshing(false);
      });
    return () => {
      live = false;
    };
  }, [key, generation]);

  const reload = useCallback(() => setGeneration((value) => value + 1), []);
  const current = state.key === key ? state : { key, entry: recall<T>(key, persist), error: null };
  return { value: current.entry?.value ?? null, refreshing, error: current.error, reload };
}

export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
