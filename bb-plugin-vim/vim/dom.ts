import { area, comparePosition, coverage, inViewport, type Box } from "./layout";

const ITEM = [
  "[data-vim-item]",
  "[data-sidebar-thread-shortcut-target]",
  '[role="option"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="treeitem"]',
].join(", ");
const PANE = '[data-vim-pane], [data-sidebar="sidebar"], main, aside, [data-split-pane-id], [role="dialog"]';
const MODAL = '[role="dialog"]:not([aria-modal="false"]), [role="alertdialog"], [role="menu"]';
const EDITOR = ".xterm, .monaco-editor, .cm-editor";
const PASSTHROUGH = `${EDITOR}, [data-app-terminal], [data-app-browser], [data-scratchpad-canvas], [data-vim-passthrough]`;
const CLICKABLE = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="combobox"]',
  ".xterm",
  ITEM,
].join(", ");
const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable]:not([contenteditable="false"])';
const SEARCH = [
  'input[type="search"]',
  '[role="searchbox"]',
  'input[aria-label*="search" i]',
  'input[placeholder*="search" i]',
  'input[aria-label*="filter" i]',
  'input[placeholder*="filter" i]',
].join(", ");
const TEXT_ENTRY = 'input, textarea, [contenteditable]:not([contenteditable="false"])';
const COMPOSER = '[data-app-composer] [contenteditable="true"], [data-app-composer] textarea';
const HIDDEN = '[inert], [hidden], [aria-hidden="true"], [data-vim-ui]';
const DISABLED = ':disabled, [aria-disabled="true"]';
const CURRENT = '[aria-current]:not([aria-current="false"]), [aria-selected="true"]';
const POPUP_TRIGGER = '[aria-haspopup]:not([aria-haspopup="false"])';
const THREAD_ROW = "[data-sidebar-thread-shortcut-target][data-sidebar-thread-id]";
const RENDERED: CheckVisibilityOptions = { visibilityProperty: true };
const OPAQUE: CheckVisibilityOptions = { visibilityProperty: true, opacityProperty: true };
const NON_TEXT_INPUTS = new Set(["checkbox", "radio", "button", "submit", "reset", "image", "file", "range", "color", "hidden"]);

export type Mode = "normal" | "insert" | "passthrough";

export function isPassthrough(el: Element | null): boolean {
  return el?.closest(PASSTHROUGH) != null;
}

export function isEditable(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(el.type);
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  const host = el.closest('[contenteditable], [role="textbox"]');
  return host !== null && host.getAttribute("contenteditable") !== "false";
}

export function modeOf(el: Element | null): Mode {
  if (isPassthrough(el)) return "passthrough";
  return isEditable(el) ? "insert" : "normal";
}

export function eventTarget(event: Event): Element | null {
  const target = event.composedPath()[0] ?? event.target;
  return target instanceof Element ? target : null;
}

function shown(el: Element, box: Box, visibility: CheckVisibilityOptions = RENDERED): boolean {
  return box.width > 0 && box.height > 0 && el.closest(HIDDEN) === null && el.checkVisibility?.(visibility) !== false;
}

export function isRendered(el: Element): boolean {
  return shown(el, el.getBoundingClientRect());
}

export function isVisible(el: Element): boolean {
  const view = el.ownerDocument.defaultView;
  const box = el.getBoundingClientRect();
  return view !== null && inViewport(box, view.innerWidth, view.innerHeight) && shown(el, box);
}

function navigable(el: Element): el is HTMLElement {
  return el instanceof HTMLElement && isRendered(el) && !el.matches(DISABLED);
}

export function scopeRoot(doc: Document): Element {
  return [...doc.querySelectorAll(MODAL)].filter(isRendered).at(-1) ?? doc.body;
}

export function paneOf(el: Element, scope: Element): Element {
  const pane = el.closest(PANE);
  return pane !== null && scope.contains(pane) ? pane : scope;
}

export function itemsIn(pane: Element, scope: Element): HTMLElement[] {
  return [...pane.querySelectorAll(ITEM)].filter((el): el is HTMLElement => navigable(el) && paneOf(el, scope) === pane);
}

export function panesIn(scope: Element): Element[] {
  const nested = [...scope.querySelectorAll(PANE)].filter(isVisible);
  const owners = new Set<Element>();
  for (const el of scope.querySelectorAll(ITEM)) {
    const owner = paneOf(el, scope);
    if (!owners.has(owner) && navigable(el)) owners.add(owner);
  }
  const ownsContent = (pane: Element) => {
    const children = nested.filter((other) => other !== pane && paneOf(other.parentElement ?? scope, scope) === pane);
    return coverage(pane.getBoundingClientRect(), children.map((child) => child.getBoundingClientRect())) < 0.5;
  };
  const panes = [scope, ...nested].filter((pane) => owners.has(pane) || ownsContent(pane));
  if (panes.length === 0) return [scope];
  return panes.sort((a, b) => comparePosition(a.getBoundingClientRect(), b.getBoundingClientRect()));
}

export function listedPane(panes: readonly Element[], el: Element, scope: Element): Element | undefined {
  const own = paneOf(el, scope);
  return panes.find((pane) => pane === own) ?? panes.find((pane) => pane.contains(el)) ?? panes.find((pane) => el.contains(pane));
}

export function largest(panes: readonly Element[]): Element {
  return panes.reduce((best, pane) => (area(pane.getBoundingClientRect()) > area(best.getBoundingClientRect()) ? pane : best));
}

export function step(items: readonly HTMLElement[], reference: Element, delta: number): HTMLElement | undefined {
  const index = items.findIndex((item) => item === reference);
  if (index >= 0) return items[Math.min(Math.max(index + delta, 0), items.length - 1)];
  const follows = (item: HTMLElement) => (reference.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  return delta > 0 ? (items.find(follows) ?? items.at(-1)) : (items.findLast((item) => !follows(item)) ?? items[0]);
}

export function currentItem(items: readonly HTMLElement[], threadId: string | null): HTMLElement | undefined {
  return items.find((item) => item.matches(CURRENT) || (threadId !== null && item.dataset.sidebarThreadId === threadId));
}

function isScrollable(el: Element): boolean {
  if (el.scrollHeight <= el.clientHeight + 1) return false;
  const { overflowY } = getComputedStyle(el);
  return overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay";
}

function outermostScrollers(el: Element): Element[] {
  return isScrollable(el) ? [el] : [...el.children].flatMap(outermostScrollers);
}

export function scrollerFor(pane: Element, from: Element | null): Element {
  for (let el = from?.parentElement ?? null; el !== null && pane.contains(el); el = el.parentElement) {
    if (isScrollable(el)) return el;
  }
  const inner = outermostScrollers(pane)
    .filter(isRendered)
    .sort((a, b) => area(b.getBoundingClientRect()) - area(a.getBoundingClientRect()))[0];
  if (inner !== undefined) return inner;
  for (let el = pane.parentElement; el !== null; el = el.parentElement) {
    if (isScrollable(el)) return el;
  }
  return pane.ownerDocument.scrollingElement ?? pane.ownerDocument.documentElement;
}

export function isFocusable(el: Element): boolean {
  return el.matches(FOCUSABLE);
}

function unoccluded(el: HTMLElement, box: Box): boolean {
  const doc = el.ownerDocument;
  const view = doc.defaultView;
  if (view === null || typeof doc.elementFromPoint !== "function") return true;
  const x = Math.min(Math.max(box.left + box.width / 2, 0), view.innerWidth - 1);
  const y = Math.min(Math.max(box.top + box.height / 2, 0), view.innerHeight - 1);
  const hit = doc.elementFromPoint(x, y);
  return hit === null || el.contains(hit) || hit.contains(el) || el.parentElement?.contains(hit) === true;
}

export function hintTargets(scope: Element): { element: HTMLElement; box: DOMRect }[] {
  const view = scope.ownerDocument.defaultView;
  if (view === null) return [];
  const seen = new Set<string>();
  return [...scope.querySelectorAll(CLICKABLE)].flatMap((element) => {
    if (!(element instanceof HTMLElement)) return [];
    const box = element.getBoundingClientRect();
    if (!inViewport(box, view.innerWidth, view.innerHeight) || !shown(element, box, OPAQUE) || element.matches(DISABLED)) return [];
    if (element.parentElement?.closest(EDITOR) != null) return [];
    const key = [box.left, box.top, box.width, box.height].map(Math.round).join(",");
    if (seen.has(key) || !unoccluded(element, box)) return [];
    seen.add(key);
    return [{ element, box }];
  });
}

function pointer(type: string): Event {
  const init = { bubbles: true, cancelable: true, composed: true, button: 0, buttons: type.endsWith("down") ? 1 : 0 };
  return type.startsWith("pointer") && typeof PointerEvent === "function"
    ? new PointerEvent(type, { ...init, pointerType: "mouse", isPrimary: true })
    : new MouseEvent(type, init);
}

function clickInApp(el: HTMLElement): void {
  const anchor = el.closest("a[href]");
  const view = el.ownerDocument.defaultView;
  if (!(anchor instanceof HTMLAnchorElement) || view === null || anchor.target === "_blank" || anchor.origin !== view.location.origin) {
    el.click();
    return;
  }
  const fallback = (event: MouseEvent) => {
    if (event.defaultPrevented) return;
    event.preventDefault();
    const path = `${anchor.pathname}${anchor.search}${anchor.hash}`;
    view.history.pushState({ usr: null, key: Math.random().toString(36).slice(2), idx: (view.history.state?.idx ?? 0) + 1 }, "", path);
    view.dispatchEvent(new PopStateEvent("popstate"));
  };
  view.addEventListener("click", fallback, { once: true });
  el.click();
  view.removeEventListener("click", fallback);
}

export function activate(el: HTMLElement): void {
  const editor = el.matches(EDITOR) ? el.querySelector<HTMLElement>('textarea, [contenteditable="true"]') : null;
  if (editor !== null || isEditable(el)) {
    (editor ?? el).focus();
    return;
  }
  if (el.matches(POPUP_TRIGGER)) {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) el.dispatchEvent(pointer(type));
  }
  clickInApp(el);
}

export function findComposer(scope: Element): HTMLElement | null {
  const editors = [...scope.querySelectorAll<HTMLElement>(COMPOSER)].filter(isRendered);
  const primary = editors.filter((el) => el.closest('[data-app-composer-role="primary"]') !== null);
  return primary.find((el) => el.closest('[data-split-pane-id][data-focused="true"]') !== null) ?? primary[0] ?? editors[0] ?? null;
}

export function firstTextEntry(root: Element): HTMLElement | null {
  return [...root.querySelectorAll<HTMLElement>(TEXT_ENTRY)].find((el) => navigable(el) && isEditable(el)) ?? null;
}

export function findSearch(scope: Element, pane: Element): HTMLElement | null {
  const inputs = [...scope.querySelectorAll<HTMLElement>(SEARCH)].filter(navigable);
  return inputs.find((el) => pane.contains(el)) ?? inputs.find(isVisible) ?? null;
}

export function deferredKeys(doc: Document): Set<string> {
  return new Set(
    [...doc.querySelectorAll("[data-vim-defer]")]
      .filter(isRendered)
      .flatMap((el) => (el.getAttribute("data-vim-defer") ?? "").split(/\s+/u).filter(Boolean)),
  );
}

export function threadRows(doc: Document): HTMLElement[] {
  return [...doc.querySelectorAll<HTMLElement>(THREAD_ROW)];
}
