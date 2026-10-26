export type Layout = "full" | "compact" | "tight";
export type Hue = "play" | "spread" | "fresh" | "vibe" | "warn" | "uv" | "clear";
export type Tag = "fresh" | "vibe" | "spread";

const DAYS = [7, 14, 30, 60, 90];

export function layoutFor({ width, height }: { width: number; height: number }): Layout {
  if (width === 0) return "full";
  if (width < 520) return "tight";
  return width >= 1000 && height >= 600 ? "full" : "compact";
}

export function flickerAt(text: string): number {
  const space = text.lastIndexOf(" ");
  return space === -1 ? Math.min(1, text.length - 1) : space + 1;
}

export const igniteDelay = (index: number) => ((index * 7) % 5) * 60 + index * 28;

export function fitSize(max: number, natural: number, available: number, floor = 0.55): { size: number; wrap: boolean } {
  if (natural <= available || natural === 0 || available <= 0) return { size: max, wrap: false };
  const size = Math.floor((max * available) / natural);
  const min = Math.round(max * floor);
  return size >= min ? { size, wrap: false } : { size: min, wrap: true };
}

export function tagFor(reason: string | null, vibe: boolean): Tag | null {
  if (reason === null) return null;
  if (/^(unheard|new to)/.test(reason)) return "fresh";
  return vibe ? "vibe" : "spread";
}

export const nextDays = (days: number) => DAYS.find((value) => value > days) ?? DAYS[0]!;

export function capFor(key: string): string | null {
  if (key === " ") return "space";
  if (["+", "=", "-", "_"].includes(key)) return "− +";
  if ([",", ".", "ArrowLeft", "ArrowRight"].includes(key)) return "← →";
  if (["j", "k", "ArrowDown", "ArrowUp"].includes(key)) return "j k";
  if (["1", "2", "3", "4"].includes(key)) return "1–4";
  if (key === "Enter") return "⏎";
  if (key === "Escape") return "esc";
  return key.length === 1 ? key : null;
}
