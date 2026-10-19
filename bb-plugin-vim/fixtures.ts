export const SHELL = `
<div data-sidebar="sidebar" data-box="0,0,240,768">
  <button data-box="8,8,224,28">New thread</button>
  <a href="/threads/t1" data-sidebar-thread-shortcut-target="" data-sidebar-thread-id="t1" data-box="0,40,240,32">Plan rollout</a>
  <a href="/threads/t2" data-sidebar-thread-shortcut-target="" data-sidebar-thread-id="t2" data-box="0,72,240,32">Fix CER retries</a>
  <a href="/threads/t3" data-sidebar-thread-shortcut-target="" data-sidebar-thread-id="t3" data-box="0,104,240,32">Review PR 12</a>
</div>
<main data-sidebar="inset" data-box="240,0,784,768">
  <div data-split-pane-id="p1" data-focused="true" data-box="240,0,784,768">
    <div id="timeline" style="overflow-y: auto" data-box="240,0,784,640" data-scroll="4000,640">
      <button id="copy" data-box="900,100,60,24">Copy</button>
    </div>
    <div data-app-composer="" data-app-composer-role="primary" data-box="240,650,784,110">
      <div id="composer" contenteditable="true" data-box="260,670,744,70"></div>
    </div>
  </div>
</main>`;

export const BOARD = `
<main data-box="0,0,1024,768">
  <input type="search" aria-label="Filter pull requests" data-box="16,8,240,32" />
  <section data-vim-pane="" aria-label="Open" data-box="16,56,300,700">
    <button data-vim-item="" id="open-1" data-box="24,100,284,80">#1</button>
    <button data-vim-item="" id="open-2" data-box="24,190,284,80">#2</button>
    <button data-vim-item="" id="open-3" data-box="24,280,284,80">#3</button>
  </section>
  <section data-vim-pane="" aria-label="Ready" data-box="330,56,300,700">
    <button data-vim-item="" id="ready-1" data-box="338,100,284,80">#4</button>
    <button data-vim-item="" id="ready-2" data-box="338,260,284,80">#5</button>
  </section>
</main>`;

function box(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, x: left, y: top, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect;
}

export function stage(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.append(root);
  for (const el of root.querySelectorAll<HTMLElement>("[data-box]")) {
    const [left = 0, top = 0, width = 0, height = 0] = el.dataset.box!.split(",").map(Number);
    el.getBoundingClientRect = () => box(left, top, width, height);
  }
  for (const el of root.querySelectorAll<HTMLElement>("[data-scroll]")) {
    const [scrollHeight = 0, clientHeight = 0] = el.dataset.scroll!.split(",").map(Number);
    Object.defineProperty(el, "scrollHeight", { configurable: true, value: scrollHeight });
    Object.defineProperty(el, "clientHeight", { configurable: true, value: clientHeight });
  }
  return root;
}

export function press(key: string, init: KeyboardEventInit = {}, target: Element = document.activeElement ?? document.body): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, composed: true, ...init });
  target.dispatchEvent(event);
  return event;
}

export function type(keys: string): void {
  for (const key of keys) press(key);
}

export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
