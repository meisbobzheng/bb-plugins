import type { PluginContentScriptContext } from "@get-bb/plugin-sdk/app";

export type Dock = "right" | "bottom";

const HEIGHT_VAR = "--panel-dock-height";
const SECONDARY_PANEL =
  'html[data-panel-dock="bottom"] [data-panel-resize-handle-id="thread-detail-secondary-panel-handle"] + [data-panel]';

const listeners = new Set<() => void>();
let storagePrefix = "panel-dock";

const root = () => document.documentElement;
const storageKey = (name: string) => `${storagePrefix}:${name}`;

export function parseDock(value: unknown): Dock {
  return value === "bottom" ? "bottom" : "right";
}

export function getDock(): Dock {
  return parseDock(root().dataset.panelDock);
}

export function setDock(dock: Dock) {
  root().dataset.panelDock = dock;
  localStorage.setItem(storageKey("dock"), dock);
  listeners.forEach((listener) => listener());
}

export function subscribeDock(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function showPanel() {
  document
    .querySelector<HTMLElement>('[aria-label^="Show right panel"]')
    ?.click();
}

function startResize(event: PointerEvent, signal: AbortSignal) {
  const panel = event.target;
  if (event.button !== 0 || !(panel instanceof HTMLElement)) return;
  if (!panel.matches(SECONDARY_PANEL) || !panel.parentElement) return;
  event.preventDefault();
  event.stopPropagation();

  const bottom = panel.parentElement.getBoundingClientRect().bottom;
  const move = (moveEvent: PointerEvent) =>
    root().style.setProperty(
      HEIGHT_VAR,
      `${Math.round(bottom - moveEvent.clientY)}px`,
    );
  const end = () => {
    panel.removeEventListener("pointermove", move);
    delete root().dataset.panelDockResizing;
    localStorage.setItem(
      storageKey("height"),
      root().style.getPropertyValue(HEIGHT_VAR),
    );
  };

  root().dataset.panelDockResizing = "";
  panel.setPointerCapture(event.pointerId);
  panel.addEventListener("pointermove", move, { signal });
  panel.addEventListener("lostpointercapture", end, { once: true, signal });
}

export function mountDock({ pluginId, signal }: PluginContentScriptContext) {
  storagePrefix = pluginId;
  root().dataset.panelDock = parseDock(localStorage.getItem(storageKey("dock")));
  const height = localStorage.getItem(storageKey("height"));
  if (height) root().style.setProperty(HEIGHT_VAR, height);

  document.addEventListener(
    "pointerdown",
    (event) => startResize(event, signal),
    { capture: true, signal },
  );

  return () => {
    delete root().dataset.panelDock;
    delete root().dataset.panelDockResizing;
    root().style.removeProperty(HEIGHT_VAR);
  };
}
