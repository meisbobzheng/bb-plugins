import { useEffect, useRef, type RefObject } from "react";
import type { SpotifyActions, SpotifyData } from "./model";
import { progressAt } from "./model";

export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function useKeys(ref: RefObject<HTMLElement | null>, handler: (event: KeyboardEvent) => boolean, autoFocus = true): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    if (autoFocus && !element.contains(document.activeElement)) element.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      if (!latest.current(event)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    element.addEventListener("keydown", onKey);
    return () => element.removeEventListener("keydown", onKey);
  }, [ref, autoFocus]);
}

export function transportKey(event: KeyboardEvent, data: SpotifyData, actions: SpotifyActions): boolean {
  const volume = data.player.device?.volumePercent ?? 50;
  const position = progressAt(data.player, Date.now());
  switch (event.key) {
    case " ":
      actions.toggle();
      return true;
    case "+":
    case "=":
      actions.setVolume(volume + 5);
      return true;
    case "-":
    case "_":
      actions.setVolume(volume - 5);
      return true;
    case ",":
      actions.seek(position - 10_000);
      return true;
    case ".":
      actions.seek(position + 10_000);
      return true;
    default:
      return false;
  }
}
