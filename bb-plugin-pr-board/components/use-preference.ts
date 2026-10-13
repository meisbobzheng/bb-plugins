import { useCallback, useMemo, useState } from "react";

function read(storageKey: string): unknown {
  try {
    const stored = window.localStorage.getItem(storageKey);
    return stored === null ? undefined : (JSON.parse(stored) as unknown);
  } catch {
    return undefined;
  }
}

function write(storageKey: string, value: unknown): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    return;
  }
}

export function usePreference<T extends string | boolean>(key: string, fallback: T, allowed?: readonly T[]): [T, (value: T) => void] {
  const storageKey = `pr-board:${key}`;
  const [value, setValue] = useState<T>(() => {
    const stored = read(storageKey);
    if (typeof stored !== typeof fallback) return fallback;
    return allowed === undefined || allowed.includes(stored as T) ? (stored as T) : fallback;
  });
  const update = useCallback(
    (next: T) => {
      setValue(next);
      write(storageKey, next);
    },
    [storageKey],
  );
  return [value, update];
}

export interface StoredSet {
  has(id: string): boolean;
  toggle(id: string): void;
  size: number;
}

export function useStoredSet(key: string): StoredSet {
  const storageKey = `pr-board:${key}`;
  const [ids, setIds] = useState<ReadonlySet<string>>(() => {
    const stored = read(storageKey);
    return new Set(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : []);
  });
  const toggle = useCallback(
    (id: string) =>
      setIds((previous) => {
        const next = new Set(previous);
        if (!next.delete(id)) next.add(id);
        write(storageKey, [...next]);
        return next;
      }),
    [storageKey],
  );
  return useMemo(() => ({ has: (id: string) => ids.has(id), toggle, size: ids.size }), [ids, toggle]);
}
