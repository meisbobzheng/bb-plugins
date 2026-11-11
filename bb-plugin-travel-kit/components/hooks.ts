import { useCallback, useEffect, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { Overview, rpcContract } from "../contract";
import { JOB_CHANNEL } from "../kit";

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useTravelKitRpc() {
  return useRpc<typeof rpcContract>();
}

export function useOverview() {
  const rpc = useTravelKitRpc();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    rpc.call("overview", null).then(
      (next) => {
        setOverview(next);
        setError(null);
      },
      (cause: unknown) => setError(errorMessage(cause)),
    );
  }, [rpc]);
  useEffect(refresh, [refresh]);
  useRealtime(JOB_CHANNEL, refresh);
  return { overview, setOverview, error, refresh };
}
