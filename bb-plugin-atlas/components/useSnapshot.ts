import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import { CHANGED_CHANNEL } from "../constants";
import type { Snapshot, rpcContract } from "../contract";

export const errorText = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

export function useAtlasRpc() {
  return useRpc<typeof rpcContract>();
}

export function useSnapshot() {
  const rpc = useAtlasRpc();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  const refetch = useCallback(() => {
    const request = ++latest.current;
    rpc.call("snapshot", null).then(
      (next) => {
        if (request !== latest.current) return;
        setSnapshot(next);
        setError(null);
      },
      (cause: unknown) => {
        if (request === latest.current) setError(errorText(cause));
      },
    );
  }, [rpc]);

  useEffect(refetch, [refetch]);
  useRealtime(CHANGED_CHANNEL, refetch);
  const connection = useRealtimeConnectionState();
  const previous = useRef(connection);
  useEffect(() => {
    if (connection === "connected" && previous.current === "reconnecting") refetch();
    previous.current = connection;
  }, [connection, refetch]);

  return { snapshot, error, refetch, setSnapshot };
}
