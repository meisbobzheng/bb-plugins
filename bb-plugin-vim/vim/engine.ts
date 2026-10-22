import { keymapFor, resolve, type Action } from "./bindings";
import {
  activate,
  currentItem,
  deferredKeys,
  eventTarget,
  findComposer,
  findSearch,
  firstTextEntry,
  hintTargets,
  isEditable,
  isFocusable,
  isPassthrough,
  isRendered,
  isVisible,
  itemsIn,
  largest,
  listedPane,
  modeOf,
  paneOf,
  panesIn,
  scopeRoot,
  scrollerFor,
  step,
  threadRows,
} from "./dom";
import { HINT_ALPHABET, hintLabels, typeHint } from "./hints";
import { IS_MAC, keyToken } from "./keys";
import { centerY, nearestTo } from "./layout";
import { IDLE, vim } from "./store";

const LINE = 60;
const PENDING_MS = 1500;
const FLASH_MS = 700;

export interface VimHost {
  openThread(threadId: string, split: boolean): void;
  threadId(): string | null;
}

export function mountVim(host: VimHost, doc: Document = document, mac: boolean = IS_MAC): () => void {
  const view = doc.defaultView ?? window;
  const keymap = keymapFor(mac);
  const leaveKeys = new Set(mac ? ["<Esc>", "<C-[>"] : ["<Esc>"]);
  const memory = new WeakMap<Element, HTMLElement>();
  let pending: readonly string[] = [];
  let pane: Element | null = null;
  let hintsMove = false;
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;
  let flashTimer: ReturnType<typeof setTimeout> | undefined;

  const setPending = (keys: readonly string[]) => {
    pending = keys;
    clearTimeout(pendingTimer);
    if (keys.length > 0) pendingTimer = setTimeout(() => setPending([]), PENDING_MS);
    vim.set({ pending: keys.join("") });
  };

  const cursor = (): HTMLElement | null => {
    const current = vim.get().cursor;
    return current !== null && current.isConnected && isRendered(current) ? current : null;
  };

  const context = () => {
    const scope = scopeRoot(doc);
    const panes = panesIn(scope);
    const active = doc.activeElement === doc.body ? null : doc.activeElement;
    const focusedSplit = doc.querySelector('[data-split-pane-id][data-focused="true"]');
    const current = [cursor(), pane, active, focusedSplit]
      .filter((el): el is Element => el !== null && el.isConnected && scope.contains(el))
      .map((el) => listedPane(panes, el, scope))
      .find((found) => found !== undefined);
    return { scope, panes, pane: current ?? largest(panes) };
  };

  const setCursor = (el: HTMLElement, scope: Element) => {
    const owner = paneOf(el, scope);
    pane = owner;
    memory.set(owner, el);
    if (isFocusable(el)) el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    vim.set({ cursor: el, flash: null });
  };

  const flash = (target: Element) => {
    clearTimeout(flashTimer);
    vim.set({ cursor: null, flash: target });
    flashTimer = setTimeout(() => vim.set({ flash: null }), FLASH_MS);
  };

  const scrollPane = (target: Element, dy: number) => {
    scrollerFor(target, cursor()).scrollTop += dy;
    return true;
  };

  const move = (delta: number) => {
    const { scope, pane: current } = context();
    const items = itemsIn(current, scope);
    if (items.length === 0) return scrollPane(current, delta * LINE);
    const active = doc.activeElement;
    const reference = active !== null && active !== doc.body && current.contains(active) ? active : cursor();
    const next = reference === null ? (currentItem(items, host.threadId()) ?? items.find(isVisible) ?? items[0]) : step(items, reference, delta);
    if (next !== undefined) setCursor(next, scope);
    return true;
  };

  const switchPane = (delta: number) => {
    const { scope, panes, pane: current } = context();
    const target = panes[panes.indexOf(current) + delta];
    if (target === undefined) return true;
    const items = itemsIn(target, scope);
    if (items.length === 0) {
      pane = target;
      const active = doc.activeElement;
      if (active instanceof HTMLElement && !target.contains(active)) active.blur();
      flash(target);
      return true;
    }
    const remembered = memory.get(target);
    const y = centerY((cursor() ?? current).getBoundingClientRect());
    const next =
      (remembered !== undefined && items.includes(remembered) ? remembered : currentItem(items, host.threadId())) ??
      items[nearestTo(items.map((item) => item.getBoundingClientRect()), y)];
    if (next !== undefined) setCursor(next, scope);
    return true;
  };

  const edge = (end: boolean) => {
    const { scope, pane: current } = context();
    const items = itemsIn(current, scope);
    const target = end ? items.at(-1) : items[0];
    if (target !== undefined) {
      setCursor(target, scope);
      return true;
    }
    const scroller = scrollerFor(current, cursor());
    scroller.scrollTop = end ? scroller.scrollHeight : 0;
    return true;
  };

  const halfPage = (direction: number) => {
    const { scope, pane: current } = context();
    const from = cursor();
    const scroller = scrollerFor(current, from);
    scroller.scrollTop += direction * Math.max(scroller.clientHeight / 2, LINE);
    const items = itemsIn(current, scope);
    if (from === null || items.length === 0) return true;
    const next = items[nearestTo(items.map((item) => item.getBoundingClientRect()), centerY(from.getBoundingClientRect()))];
    if (next !== undefined) setCursor(next, scope);
    return true;
  };

  const open = (split: boolean) => {
    const target = cursor();
    if (target === null) return false;
    const threadId = target.getAttribute("data-sidebar-thread-id");
    if (split && threadId !== null) host.openThread(threadId, true);
    else activate(target);
    return true;
  };

  const startHints = (moveCursor: boolean) => {
    const targets = hintTargets(scopeRoot(doc));
    const labels = hintLabels(targets.length);
    hintsMove = moveCursor;
    if (targets.length > 0) {
      vim.set({ hints: targets.map((target, index) => ({ ...target, label: labels[index]! })), typed: "" });
    }
    return true;
  };

  const endHints = () => vim.set({ hints: null, typed: "" });

  const typeInHints = (token: string) => {
    const { hints, typed } = vim.get();
    if (hints === null) return;
    if (token === "<BS>") return vim.set({ typed: typed.slice(0, -1) });
    if (token.length !== 1 || !HINT_ALPHABET.includes(token.toLowerCase())) return endHints();
    const input = typeHint(hints.map((hint) => hint.label), typed, token);
    if (input.chosen === null) return vim.set({ typed: input.typed });
    const { element } = hints[input.chosen]!;
    endHints();
    if (!element.isConnected) return;
    const scope = scopeRoot(doc);
    if (hintsMove) {
      setCursor(element, scope);
      return;
    }
    pane = paneOf(element, scope);
    vim.set({ cursor: null });
    activate(element);
  };

  const thread = (delta: number) => {
    const rows = threadRows(doc);
    const index = rows.findIndex((row) => row.dataset.sidebarThreadId === host.threadId());
    const next = index < 0 ? (delta > 0 ? rows[0] : rows.at(-1)) : rows[index + delta];
    const threadId = next?.dataset.sidebarThreadId;
    if (threadId !== undefined) host.openThread(threadId, false);
    return true;
  };

  const focusComposer = () => {
    const { scope, pane: current } = context();
    (findComposer(scope) ?? firstTextEntry(current) ?? firstTextEntry(scope))?.focus();
    return true;
  };

  const focusSearch = () => {
    const { scope, pane: current } = context();
    const search = findSearch(scope, current);
    if (search === null) return focusComposer();
    search.focus();
    return true;
  };

  const leave = () => {
    const active = doc.activeElement;
    if (active instanceof HTMLElement && active === cursor()) active.blur();
    vim.set({ cursor: null, flash: null });
    return false;
  };

  const always = (effect: () => void) => () => {
    effect();
    return true;
  };

  const actions: Record<Action, () => boolean> = {
    down: () => move(1),
    up: () => move(-1),
    left: () => switchPane(-1),
    right: () => switchPane(1),
    top: () => edge(false),
    bottom: () => edge(true),
    halfDown: () => halfPage(1),
    halfUp: () => halfPage(-1),
    open: () => open(false),
    openSplit: () => open(true),
    hint: () => startHints(false),
    hintCursor: () => startHints(true),
    composer: focusComposer,
    search: focusSearch,
    leave,
    nextThread: () => thread(1),
    previousThread: () => thread(-1),
    back: always(() => view.history.back()),
    forward: always(() => view.history.forward()),
    help: always(vim.toggleHelp),
  };

  const consume = (event: KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) return;
    const token = keyToken(event);
    if (token === null) return;
    if (vim.get().hints !== null) {
      consume(event);
      typeInHints(token);
      return;
    }
    const target = eventTarget(event);
    if (isEditable(target) || isPassthrough(target)) return;
    if (pending.length === 0 && deferredKeys(doc).has(token)) return;
    const resolution = resolve(keymap, pending, token);
    if (resolution.kind === "pending") {
      consume(event);
      setPending(resolution.keys);
      return;
    }
    const hadPending = pending.length > 0;
    setPending([]);
    const handled = resolution.kind === "run" && actions[resolution.action]();
    if (handled || hadPending) consume(event);
  };

  const onLeaveInsert = (event: KeyboardEvent) => {
    const token = keyToken(event);
    const target = eventTarget(event);
    if (token === null || !leaveKeys.has(token) || !(target instanceof HTMLElement) || !isEditable(target) || isPassthrough(target)) return;
    setTimeout(() => {
      if (event.defaultPrevented || !target.isConnected) return;
      pane = paneOf(target, scopeRoot(doc));
      target.blur();
    }, 0);
  };

  const onPointerDown = (event: PointerEvent) => {
    const target = eventTarget(event);
    if (target === null || target.closest("[data-vim-ui]") !== null) return;
    endHints();
    pane = paneOf(target, scopeRoot(doc));
    vim.set({ cursor: null, flash: null });
  };

  const onFocusChange = () =>
    queueMicrotask(() => {
      const active = doc.activeElement;
      const current = vim.get().cursor;
      const strayed = current !== null && active !== null && active !== doc.body && !current.contains(active);
      vim.set(strayed ? { mode: modeOf(active), cursor: null } : { mode: modeOf(active) });
    });

  view.addEventListener("keydown", onKeyDown);
  view.addEventListener("keydown", onLeaveInsert, true);
  view.addEventListener("wheel", endHints, { passive: true });
  view.addEventListener("resize", endHints);
  doc.addEventListener("pointerdown", onPointerDown, true);
  doc.addEventListener("focusin", onFocusChange);
  doc.addEventListener("focusout", onFocusChange);
  onFocusChange();

  return () => {
    view.removeEventListener("keydown", onKeyDown);
    view.removeEventListener("keydown", onLeaveInsert, true);
    view.removeEventListener("wheel", endHints);
    view.removeEventListener("resize", endHints);
    doc.removeEventListener("pointerdown", onPointerDown, true);
    doc.removeEventListener("focusin", onFocusChange);
    doc.removeEventListener("focusout", onFocusChange);
    clearTimeout(pendingTimer);
    clearTimeout(flashTimer);
    vim.set(IDLE);
  };
}
