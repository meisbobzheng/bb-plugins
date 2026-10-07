import { useCallback, useState } from "react";

export function usePreference<T extends string | boolean>(key: string, fallback: T, allowed?: readonly T[]): [T, (value: T) => void] {
  const storageKey = `pr-board:${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === null) return fallback;
      const parsed = JSON.parse(stored) as unknown;
      if (typeof parsed !== typeof fallback) return fallback;
      return allowed === undefined || allowed.includes(parsed as T) ? (parsed as T) : fallback;
    } catch {
      return fallback;
    }
  });
  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        return;
      }
    },
    [storageKey],
  );
  return [value, update];
}
