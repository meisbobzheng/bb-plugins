import { useSyncExternalStore } from "react";
import type { Connection } from "../contract";

export interface Session {
  connections: Connection[];
  activeId: string | null;
  loaded: boolean;
  error: string | null;
}

let state: Session = { connections: [], activeId: null, loaded: false, error: null };
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readSession(): Session {
  return state;
}

export function updateSession(patch: Partial<Session>): void {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export function resetSession(): void {
  state = { connections: [], activeId: null, loaded: false, error: null };
  listeners.forEach((listener) => listener());
}

export function useSession(): Session {
  return useSyncExternalStore(subscribe, readSession, readSession);
}

export function activeConnection(session: Session): Connection | null {
  return session.connections.find((connection) => connection.id === session.activeId) ?? session.connections[0] ?? null;
}
