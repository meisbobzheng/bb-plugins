import { useSyncExternalStore } from "react";
import type { AskResult, ExplainResult, QueryRun, SchemaSnapshot, TableInfo } from "../contract";

export type View = { kind: "results" } | { kind: "plan"; plan: ExplainResult; sql: string } | { kind: "table"; table: TableInfo };

export interface AskState {
  prompt: string;
  busy: boolean;
  result: AskResult | null;
  error: string | null;
}

export interface WorkbenchState {
  run: QueryRun | null;
  ranSql: string;
  runningId: string | null;
  explaining: boolean;
  view: View;
  ask: AskState;
}

export type WorkbenchPatch = Partial<WorkbenchState> | ((current: WorkbenchState) => Partial<WorkbenchState>);

const INITIAL: WorkbenchState = {
  run: null,
  ranSql: "",
  runningId: null,
  explaining: false,
  view: { kind: "results" },
  ask: { prompt: "", busy: false, result: null, error: null },
};

const workbenches = new Map<string, WorkbenchState>();
const schemas = new Map<string, SchemaSnapshot>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readWorkbench(connectionId: string): WorkbenchState {
  return workbenches.get(connectionId) ?? INITIAL;
}

export function updateWorkbench(connectionId: string, patch: WorkbenchPatch): void {
  const current = readWorkbench(connectionId);
  workbenches.set(connectionId, { ...current, ...(typeof patch === "function" ? patch(current) : patch) });
  listeners.forEach((listener) => listener());
}

export function useWorkbench(connectionId: string): WorkbenchState {
  const read = () => readWorkbench(connectionId);
  return useSyncExternalStore(subscribe, read, read);
}

export function cachedSchema(key: string): SchemaSnapshot | null {
  return schemas.get(key) ?? null;
}

export function rememberSchema(key: string, snapshot: SchemaSnapshot): void {
  schemas.set(key, snapshot);
}

export function resetWorkbenches(): void {
  workbenches.clear();
  schemas.clear();
  listeners.forEach((listener) => listener());
}
