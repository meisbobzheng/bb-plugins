import { useCallback, useEffect, useMemo, useState, type DependencyList } from "react";
import { useRealtime, useRpc, useSdk, type PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { EMPTY_STATE, STATE_CHANGED, type LauncherState } from "../model";
import type { rpcContract } from "../server";

export type Sdk = PluginBrowserBbSdk;
export type AppConfig = Awaited<ReturnType<Sdk["system"]["config"]>>;
export type PluginEntry = Awaited<ReturnType<Sdk["plugins"]["list"]>>["plugins"][number];
export type PluginSettings = Awaited<ReturnType<Sdk["plugins"]["getSettings"]>>;
export type ThemeCatalog = Awaited<ReturnType<Sdk["theme"]["catalog"]>>;
export type SearchHit = Awaited<ReturnType<Sdk["threads"]["search"]>>["active"]["results"][number];
export type OutlineItem = Awaited<ReturnType<Sdk["threads"]["conversationOutline"]>>["items"][number];

export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function reportError(title: string) {
  return (cause: unknown) => toast.error(title, { description: errorMessage(cause) });
}

export interface AsyncState<T> {
  data: T | undefined;
  error: unknown;
  reload(): void;
}

export function useAsync<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: DependencyList,
): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>(null);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).then(
      (value) => {
        if (controller.signal.aborted) return;
        setData(value);
        setError(null);
      },
      (cause: unknown) => {
        if (!controller.signal.aborted) setError(cause);
      },
    );
    return () => controller.abort();
  }, [...deps, generation]);
  const reload = useCallback(() => setGeneration((value) => value + 1), []);
  return useMemo(() => ({ data, error, reload }), [data, error, reload]);
}

export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function useLauncherState() {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<LauncherState>(EMPTY_STATE);
  const refresh = useCallback(() => {
    rpc.call("state_get").then(setState, () => undefined);
  }, [rpc]);
  useEffect(refresh, [refresh]);
  useRealtime(STATE_CHANGED, refresh);
  const recordUse = useCallback(
    (key: string) => {
      rpc.call("usage_record", { key }).then(setState, () => undefined);
    },
    [rpc],
  );
  const setProjectPinned = useCallback(
    (projectId: string, pinned: boolean) =>
      rpc.call("project_pin_set", { projectId, pinned }).then(setState),
    [rpc],
  );
  return { state, recordUse, setProjectPinned };
}

export function useAppConfig(open: boolean): AsyncState<AppConfig> {
  const sdk = useSdk();
  const config = useAsync((signal) => sdk.system.config({ signal }), [sdk]);
  const { reload } = config;
  useEffect(() => {
    if (open) reload();
  }, [open, reload]);
  return config;
}

export function useMessageSearch(query: string): SearchHit[] {
  const sdk = useSdk();
  const debounced = useDebounced(query.trim(), 250);
  const { data } = useAsync(
    (signal) =>
      debounced.length < 3
        ? Promise.resolve([])
        : sdk.threads
            .search({ query: debounced, limitPerGroup: "8", signal })
            .then(({ active }) =>
              active.results.filter((hit) =>
                hit.matches.some((match) => match.sourceKind.endsWith("_message")),
              ),
            ),
    [sdk, debounced],
  );
  return query.trim().length < 3 ? [] : (data ?? []);
}
