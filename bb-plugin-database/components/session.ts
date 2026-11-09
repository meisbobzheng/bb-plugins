import { useSyncExternalStore } from "react";
import type { AwsProfile, Connection } from "../contract";

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

export const OTHER_ACCOUNT = "Other";

export interface ConnectionGroup {
  label: string;
  connections: Connection[];
}

export function groupByAccount(connections: readonly Connection[], profiles: readonly AwsProfile[]): ConnectionGroup[] {
  const groups = new Map<string, Connection[]>();
  for (const connection of connections) {
    const { auth } = connection;
    const profile = auth.kind === "rds-iam" ? profiles.find((candidate) => candidate.name === auth.profile) : undefined;
    const label = auth.kind === "rds-iam" ? (profile?.accountName ?? profile?.accountId ?? auth.profile) : OTHER_ACCOUNT;
    groups.set(label, [...(groups.get(label) ?? []), connection]);
  }
  return [...groups]
    .map(([label, members]) => ({ label, connections: members }))
    .sort((a, b) => Number(a.label === OTHER_ACCOUNT) - Number(b.label === OTHER_ACCOUNT) || a.label.localeCompare(b.label));
}
