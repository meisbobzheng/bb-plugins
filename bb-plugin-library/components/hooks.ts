import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { CatalogTag, Entry, SearchInput, SearchResult, rpcContract } from "../contract";
import { CHANGED_CHANNEL } from "../library";

const SEARCH_DEBOUNCE_MS = 120;

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useLibraryRpc() {
  return useRpc<typeof rpcContract>();
}

function useLibraryVersion(): number {
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((current) => current + 1), []);
  useRealtime(CHANGED_CHANNEL, bump);
  const connection = useRealtimeConnectionState();
  const previous = useRef(connection);
  useEffect(() => {
    if (connection === "connected" && previous.current === "reconnecting") bump();
    previous.current = connection;
  }, [connection, bump]);
  return version;
}

export function useLibrarySearch(input: SearchInput) {
  const rpc = useLibraryRpc();
  const version = useLibraryVersion();
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(input);
  const isQueryEmpty = input.query.trim() === "";

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(
      () => {
        rpc.call("search", JSON.parse(key) as SearchInput).then(
          (next) => {
            if (cancelled) return;
            setResult(next);
            setError(null);
          },
          (cause: unknown) => {
            if (!cancelled) setError(errorMessage(cause));
          },
        );
      },
      isQueryEmpty ? 0 : SEARCH_DEBOUNCE_MS,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [rpc, key, isQueryEmpty, version]);

  return { result, error };
}

export function useTagCatalog(): ReadonlyMap<string, CatalogTag> {
  const rpc = useLibraryRpc();
  const version = useLibraryVersion();
  const [catalog, setCatalog] = useState<ReadonlyMap<string, CatalogTag>>(() => new Map());

  useEffect(() => {
    let cancelled = false;
    rpc.call("catalog", null).then(
      ({ tags }) => {
        if (!cancelled) setCatalog(new Map(tags.map((tag) => [tag.tag.toLowerCase(), tag])));
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [rpc, version]);

  return catalog;
}

export function useEntry(id: string) {
  const rpc = useLibraryRpc();
  const version = useLibraryVersion();
  const [loaded, setLoaded] = useState<{ id: string; entry: Entry | null; error: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    rpc.call("entry", { id }).then(
      (entry) => {
        if (!cancelled) setLoaded({ id, entry, error: null });
      },
      (cause: unknown) => {
        if (!cancelled) setLoaded((current) => ({ id, entry: current?.id === id ? current.entry : null, error: errorMessage(cause) }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [rpc, id, version]);

  const current = loaded?.id === id ? loaded : null;
  return { entry: current === null ? undefined : current.entry, error: current?.error ?? null };
}
