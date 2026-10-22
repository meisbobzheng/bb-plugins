import type { PluginContentScriptContext } from "@get-bb/plugin-sdk/app";

export type Dock = "right" | "bottom";

interface Float {
  threadId: string;
  wasOpen: boolean;
  returnFocus: Element | null;
  observer?: MutationObserver;
}

const HEIGHT_VAR = "--panel-dock-height";
const PANEL =
  '[data-panel-resize-handle-id="thread-detail-secondary-panel-handle"] + [data-panel]';
const BOTTOM_PANEL = `html[data-panel-dock="bottom"]:not([data-panel-float]) ${PANEL}`;

const listeners = new Set<() => void>();
let storagePrefix = "panel-dock";
let float: Float | null = null;

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

function clickPanelToggle(action: "Show" | "Hide") {
  document
    .querySelector<HTMLElement>(`[aria-label^="${action} right panel"]`)
    ?.click();
}

export const showPanel = () => clickPanelToggle("Show");

export const floatingThreadId = () => float?.threadId ?? null;

export function startFloat(threadId: string) {
  float = {
    threadId,
    wasOpen: document.querySelector('[aria-label^="Hide right panel"]') !== null,
    returnFocus: document.activeElement,
  };
  root().dataset.panelFloat = "";
  return float;
}

export function settleFloat(started: Float) {
  if (float !== started) {
    if (!float && !started.wasOpen) clickPanelToggle("Hide");
    return;
  }
  const aside = document.querySelector(`${PANEL} > aside`);
  if (!aside) return;
  started.observer = new MutationObserver(() => {
    if (aside.getAttribute("aria-hidden") === "true") endFloat({ hide: false });
  });
  started.observer.observe(aside, { attributeFilter: ["aria-hidden"] });
  focusTerminal(started);
}

export function endFloat({ hide = true } = {}) {
  if (!float) return;
  const { wasOpen, returnFocus, observer } = float;
  float = null;
  observer?.disconnect();
  if (hide && !wasOpen) clickPanelToggle("Hide");
  delete root().dataset.panelFloat;
  if (returnFocus instanceof HTMLElement && returnFocus.isConnected) {
    returnFocus.focus();
  }
}

function focusTerminal(started: Float, frames = 60) {
  if (float !== started) return;
  const target = document.querySelector<HTMLElement>(
    `${PANEL} [data-app-terminal] textarea`,
  );
  if (target) target.focus();
  else if (frames > 0) {
    requestAnimationFrame(() => focusTerminal(started, frames - 1));
  }
}

const isBottomPanel = (target: EventTarget | null): target is HTMLElement =>
  target instanceof HTMLElement && target.matches(BOTTOM_PANEL);

function startResize(event: PointerEvent, signal: AbortSignal) {
  const panel = event.target;
  if (event.button !== 0 || !isBottomPanel(panel) || !panel.parentElement) return;
  event.preventDefault();
  event.stopPropagation();

  const bottom = panel.parentElement.getBoundingClientRect().bottom;
  const move = (moveEvent: PointerEvent) =>
    panel.style.setProperty(
      HEIGHT_VAR,
      `${Math.round(bottom - moveEvent.clientY)}px`,
    );
  const end = () => {
    panel.removeEventListener("pointermove", move);
    delete root().dataset.panelDockResizing;
    const height = panel.style.getPropertyValue(HEIGHT_VAR);
    if (!height) return;
    panel.style.removeProperty(HEIGHT_VAR);
    root().style.setProperty(HEIGHT_VAR, height);
    localStorage.setItem(storageKey("height"), height);
  };

  root().dataset.panelDockResizing = "";
  panel.setPointerCapture(event.pointerId);
  panel.addEventListener("pointermove", move, { signal });
  panel.addEventListener("lostpointercapture", end, { once: true, signal });
}

function resetHeight(event: MouseEvent) {
  if (event.detail !== 2 || !isBottomPanel(event.target)) return;
  root().style.removeProperty(HEIGHT_VAR);
  localStorage.removeItem(storageKey("height"));
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
  document.addEventListener("click", resetHeight, { capture: true, signal });

  return () => {
    endFloat({ hide: false });
    delete root().dataset.panelDock;
    delete root().dataset.panelDockResizing;
    root().style.removeProperty(HEIGHT_VAR);
    document.querySelector<HTMLElement>(PANEL)?.style.removeProperty(HEIGHT_VAR);
  };
}
