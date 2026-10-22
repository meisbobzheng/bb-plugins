import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRealtimeConnectionState, useRpc, type PluginRpcClient } from "@get-bb/plugin-sdk/app";
import { CHANGED_CHANNEL, type ChangedKind } from "../channel";
import type { SchemaSnapshot, Status, rpcContract } from "../contract";
import { readSession, updateSession, useSession, type Session } from "./session";

export type DbRpc = PluginRpcClient<typeof rpcContract>;

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useDbRpc(): DbRpc {
  return useRpc<typeof rpcContract>();
}

function isChange(payload: unknown): payload is { kind: ChangedKind } {
  return typeof payload === "object" && payload !== null && typeof (payload as { kind?: unknown }).kind === "string";
}

export function useChanged(kinds: readonly ChangedKind[], handler: () => void): void {
  const latest = useRef(handler);
  latest.current = handler;
  const key = kinds.join(",");
  useRealtime(CHANGED_CHANNEL, (payload: unknown) => {
    if (isChange(payload) && key.split(",").includes(payload.kind)) latest.current();
  });
  const connection = useRealtimeConnectionState();
  const previous = useRef(connection);
  useEffect(() => {
    if (connection === "connected" && previous.current === "reconnecting") latest.current();
    previous.current = connection;
  }, [connection]);
}

let inflight: Promise<void> | null = null;
let queued = false;

export function refreshSession(rpc: DbRpc): Promise<void> {
  if (inflight !== null) {
    queued = true;
    return inflight;
  }
  inflight = rpc
    .call("connections_list", null)
    .then(
      ({ connections, activeId }) => updateSession({ connections, activeId, loaded: true, error: null }),
      (error: unknown) => updateSession({ loaded: true, error: errorMessage(error) }),
    )
    .finally(() => {
      inflight = null;
      if (queued) {
        queued = false;
        void refreshSession(rpc);
      }
    });
  return inflight;
}

export function useSessionSync(): Session {
  const rpc = useDbRpc();
  const session = useSession();
  useEffect(() => {
    if (!readSession().loaded) void refreshSession(rpc);
  }, [rpc]);
  useChanged(["connections"], () => void refreshSession(rpc));
  return session;
}

export interface SchemaState {
  snapshot: SchemaSnapshot | null;
  loading: boolean;
  error: string | null;
  refresh(force: boolean): void;
}

export function useSchema(connectionId: string | null, fingerprint: string): SchemaState {
  const rpc = useDbRpc();
  const [state, setState] = useState<{ key: string; snapshot: SchemaSnapshot | null; loading: boolean; error: string | null }>({
    key: "",
    snapshot: null,
    loading: false,
    error: null,
  });
  const [generation, setGeneration] = useState(0);
  const force = useRef(false);
  const key = `${connectionId ?? ""}|${fingerprint}`;

  useEffect(() => {
    if (connectionId === null) {
      setState({ key, snapshot: null, loading: false, error: null });
      return;
    }
    let live = true;
    const refresh = force.current;
    force.current = false;
    setState((current) => ({ key, snapshot: current.key === key ? current.snapshot : null, loading: true, error: null }));
    rpc.call("schema_get", { connectionId, refresh }).then(
      (snapshot) => {
        if (live) setState({ key, snapshot, loading: false, error: null });
      },
      (error: unknown) => {
        if (live) setState((current) => ({ key, snapshot: current.snapshot, loading: false, error: errorMessage(error) }));
      },
    );
    return () => {
      live = false;
    };
  }, [rpc, connectionId, key, generation]);

  const refresh = useCallback((hard: boolean) => {
    force.current = hard;
    setGeneration((value) => value + 1);
  }, []);

  return { snapshot: state.key === key ? state.snapshot : null, loading: state.loading, error: state.error, refresh };
}

let statusCache: Status | null = null;

export function useStatus(): Status | null {
  const rpc = useDbRpc();
  const [status, setStatus] = useState<Status | null>(statusCache);
  useEffect(() => {
    let live = true;
    rpc.call("status", null).then(
      (next) => {
        statusCache = next;
        if (live) setStatus(next);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [rpc]);
  return status;
}

export function useLocalDraft(key: string): [string, (value: string) => void] {
  const storageKey = `database:draft:${key}`;
  const [value, setValue] = useState(() => {
    try {
      return window.localStorage.getItem(storageKey) ?? "";
    } catch {
      return "";
    }
  });
  const keyRef = useRef(storageKey);
  useEffect(() => {
    if (keyRef.current === storageKey) return;
    keyRef.current = storageKey;
    try {
      setValue(window.localStorage.getItem(storageKey) ?? "");
    } catch {
      setValue("");
    }
  }, [storageKey]);
  const update = useCallback(
    (next: string) => {
      setValue(next);
      try {
        window.localStorage.setItem(storageKey, next);
      } catch {
        return;
      }
    },
    [storageKey],
  );
  return [value, update];
}
