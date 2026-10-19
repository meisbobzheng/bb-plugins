import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();

function set(next: boolean) {
  if (open === next) return;
  open = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const launcher = {
  isOpen: () => open,
  open: () => set(true),
  close: () => set(false),
  toggle: () => set(!open),
};

export function useLauncherOpen(): boolean {
  return useSyncExternalStore(subscribe, launcher.isOpen);
}
