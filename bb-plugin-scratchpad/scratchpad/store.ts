import { useSyncExternalStore } from "react";

export interface ActiveBoard {
  id: string;
  name: string;
}

interface ScratchpadState {
  open: boolean;
  activeBoard: ActiveBoard | null;
}

let state: ScratchpadState = { open: false, activeBoard: null };
const listeners = new Set<() => void>();

function update(patch: Partial<ScratchpadState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const scratchpad = {
  get: () => state,
  toggle: () => update({ open: !state.open }),
  close: () => update({ open: false }),
  setActiveBoard: (activeBoard: ActiveBoard | null) => update({ activeBoard }),
};

export function useScratchpad(): ScratchpadState {
  return useSyncExternalStore(subscribe, scratchpad.get);
}
