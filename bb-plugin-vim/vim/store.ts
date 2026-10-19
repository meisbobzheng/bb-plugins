import { useSyncExternalStore } from "react";
import type { Mode } from "./dom";
import type { Box } from "./layout";

export interface Hint {
  label: string;
  element: HTMLElement;
  box: Box;
}

export interface VimState {
  mode: Mode;
  pending: string;
  hints: readonly Hint[] | null;
  typed: string;
  cursor: HTMLElement | null;
  flash: Element | null;
  help: boolean;
  paused: boolean;
}

export const IDLE: Pick<VimState, "pending" | "hints" | "typed" | "cursor" | "flash"> = {
  pending: "",
  hints: null,
  typed: "",
  cursor: null,
  flash: null,
};

let state: VimState = { ...IDLE, mode: "normal", help: false, paused: false };
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const vim = {
  get: () => state,
  set(patch: Partial<VimState>) {
    const next = { ...state, ...patch };
    if ((Object.keys(patch) as (keyof VimState)[]).every((key) => next[key] === state[key])) return;
    state = next;
    for (const listener of listeners) listener();
  },
  toggleHelp: () => vim.set({ help: !state.help }),
  togglePaused: () => vim.set({ paused: !state.paused }),
};

export function useVimState(): VimState {
  return useSyncExternalStore(subscribe, vim.get);
}
