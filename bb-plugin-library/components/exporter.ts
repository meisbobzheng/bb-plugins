import { LIGHT_THEME, printCss, type ExportTheme, type RenderedEntry } from "../export";

const PRINT_ROOT_ID = "library-print";
const PRINT_CLEANUP_MS = 120_000;

interface WritableFile {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}

interface SavePicker {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<{ name: string; createWritable(): Promise<WritableFile> }>;
}

export interface SaveTarget {
  name: string;
  type: string;
  description: string;
  data: string;
}

export type SaveOutcome = { kind: "saved"; name: string } | { kind: "downloaded"; name: string } | { kind: "cancelled" };

function isTransparent(color: string): boolean {
  return color === "" || color === "transparent" || /^rgba\(.*,\s*0\)$/.test(color);
}

export function themeOf(element: HTMLElement): ExportTheme {
  const foreground = getComputedStyle(element).color;
  for (let node: HTMLElement | null = element; node !== null; node = node.parentElement) {
    const background = getComputedStyle(node).backgroundColor;
    if (!isTransparent(background)) return { background, foreground: foreground || LIGHT_THEME.foreground };
  }
  return LIGHT_THEME;
}

export function captureDiagrams(container: HTMLElement): string[] {
  return [...container.querySelectorAll("svg[aria-roledescription]")]
    .filter((svg) => svg.parentElement?.closest("svg") == null)
    .map((svg) => svg.outerHTML);
}

function download(target: SaveTarget, blob: Blob): SaveOutcome {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = target.name;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { kind: "downloaded", name: target.name };
}

export async function saveFile(target: SaveTarget): Promise<SaveOutcome> {
  const blob = new Blob([target.data], { type: `${target.type};charset=utf-8` });
  const picker = (window as unknown as SavePicker).showSaveFilePicker;
  if (typeof picker !== "function") return download(target, blob);
  const extension = target.name.slice(target.name.lastIndexOf("."));
  let handle;
  try {
    handle = await picker.call(window, { suggestedName: target.name, types: [{ description: target.description, accept: { [target.type]: [extension] } }] });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return { kind: "cancelled" };
    return download(target, blob);
  }
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
  return { kind: "saved", name: handle.name };
}

export function printEntry(rendered: RenderedEntry, theme: ExportTheme): void {
  document.getElementById(PRINT_ROOT_ID)?.remove();
  const root = document.createElement("div");
  root.id = PRINT_ROOT_ID;
  root.innerHTML = `<article class="library-export">${rendered.body}</article>`;
  const style = document.createElement("style");
  style.textContent = `${rendered.css}${printCss(PRINT_ROOT_ID, theme)}`;
  const previousTitle = document.title;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => {
    window.removeEventListener("afterprint", cleanup);
    clearTimeout(timer);
    root.remove();
    style.remove();
    document.title = previousTitle;
  };
  document.head.append(style);
  document.body.append(root);
  document.title = rendered.title;
  window.addEventListener("afterprint", cleanup);
  timer = setTimeout(cleanup, PRINT_CLEANUP_MS);
  window.print();
}
