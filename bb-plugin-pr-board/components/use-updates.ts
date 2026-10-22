import { useEffect, useRef } from "react";
import { useRealtime, useRealtimeConnectionState } from "@get-bb/plugin-sdk/app";
import { UPDATES_CHANNEL } from "../channel";
import type { PullRoute } from "../routes";

function concerns(payload: unknown, pull: PullRoute | null): boolean {
  if (pull === null || typeof payload !== "object" || payload === null) return true;
  const { repo, number } = payload as { repo?: unknown; number?: unknown };
  return repo === pull.repo && number === pull.number;
}

export function useUpdates(pull: PullRoute | null, onUpdate: () => void): void {
  const latest = useRef(onUpdate);
  latest.current = onUpdate;
  useRealtime(UPDATES_CHANNEL, (payload) => {
    if (concerns(payload, pull)) latest.current();
  });
  const connection = useRealtimeConnectionState();
  const previous = useRef(connection);
  useEffect(() => {
    if (previous.current === "reconnecting" && connection === "connected") latest.current();
    previous.current = connection;
  }, [connection]);
}
