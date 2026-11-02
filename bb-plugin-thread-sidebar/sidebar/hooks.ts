import { useCallback, useEffect, useRef, useState } from "react";
import { experimental_usePluginId } from "@get-bb/plugin-sdk/app";
import { parseKeys, toggleKey } from "./model";

export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function useStableCallback(callback: () => void): () => void {
  const ref = useRef(callback);
  useEffect(() => {
    ref.current = callback;
  });
  return useCallback(() => ref.current(), []);
}

export function useKeySet(name: string): { keys: ReadonlySet<string>; toggle(key: string): void } {
  const storageKey = `${experimental_usePluginId()}:${name}`;
  const [keys, setKeys] = useState<ReadonlySet<string>>(() => new Set(parseKeys(localStorage.getItem(storageKey))));
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey) setKeys(new Set(parseKeys(event.newValue)));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [storageKey]);
  const toggle = useCallback(
    (key: string) =>
      setKeys((current) => {
        const next = toggleKey(current, key);
        localStorage.setItem(storageKey, JSON.stringify([...next]));
        return next;
      }),
    [storageKey],
  );
  return { keys, toggle };
}
