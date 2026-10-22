import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useBbContext, useBbNavigate, useSettings } from "@get-bb/plugin-sdk/app";
import { usePortalScopeProps } from "@/lib/portal-scope";
import { mountVim } from "./engine";
import { Help } from "./Help";
import { area, labelTop } from "./layout";
import { useVimState, type Hint, type VimState } from "./store";

const LAYER = "pointer-events-none fixed z-[2147483647]";
const HINT_HEIGHT = 16;
const CORNER = { width: 160, height: 48 };

function Ring({ target }: { target: Element }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    let drawn = "";
    const paint = () => {
      const box = target.getBoundingClientRect();
      const ring = ref.current;
      const next = `${box.left},${box.top},${box.width},${box.height}`;
      if (ring !== null && next !== drawn) {
        drawn = next;
        ring.hidden = area(box) === 0;
        ring.style.transform = `translate(${box.left - 2}px, ${box.top - 2}px)`;
        ring.style.width = `${box.width + 4}px`;
        ring.style.height = `${box.height + 4}px`;
      }
      frame = requestAnimationFrame(paint);
    };
    paint();
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return <div ref={ref} data-vim-ring="" className={`${LAYER} left-0 top-0 rounded-md border-2 border-primary`} />;
}

function Hints({ hints, typed }: { hints: readonly Hint[]; typed: string }) {
  return hints
    .filter((hint) => hint.label.startsWith(typed))
    .map((hint) => (
      <span
        key={hint.label}
        data-vim-hint={hint.label}
        style={{ left: Math.max(hint.box.left, 0), top: labelTop(hint.box, HINT_HEIGHT, window.innerHeight) }}
        className={`${LAYER} rounded-sm bg-primary px-1 font-mono text-[11px] font-bold uppercase leading-4 text-primary-foreground shadow-md`}
      >
        <span className="opacity-50">{typed}</span>
        {hint.label.slice(typed.length)}
      </span>
    ));
}

function modeLabel(state: VimState): string {
  if (state.paused) return "PAUSED";
  if (state.hints !== null) return "HINT";
  return { normal: "NORMAL", insert: "INSERT", passthrough: "PASS" }[state.mode];
}

function ModeIndicator({ state }: { state: VimState }) {
  const ref = useRef<HTMLDivElement>(null);
  const keys = state.hints === null ? state.pending : state.typed;
  useEffect(() => {
    const dodge = (event: MouseEvent) =>
      ref.current?.toggleAttribute("data-near", event.clientX > window.innerWidth - CORNER.width && event.clientY > window.innerHeight - CORNER.height);
    window.addEventListener("pointermove", dodge, { passive: true });
    return () => window.removeEventListener("pointermove", dodge);
  }, []);
  return (
    <div
      ref={ref}
      data-vim-mode=""
      className={`${LAYER} bottom-1.5 right-2 rounded bg-muted/90 px-1.5 font-mono text-[10px] font-semibold leading-4 tracking-wide text-muted-foreground transition-opacity data-[near]:opacity-0`}
    >
      {modeLabel(state)}
      {keys === "" ? null : <span className="ml-1.5 text-foreground">{keys}</span>}
    </div>
  );
}

export function VimOverlay() {
  const { values } = useSettings();
  const navigate = useBbNavigate();
  const { threadId } = useBbContext();
  const state = useVimState();
  const scopeProps = usePortalScopeProps();
  const latest = useRef({ navigate, threadId });
  const enabled = values?.enabled !== false;

  useEffect(() => {
    latest.current = { navigate, threadId };
  });

  useEffect(() => {
    if (!enabled || state.paused) return;
    return mountVim({
      openThread: (id, split) => latest.current.navigate.toThread(id, split ? { split: true } : undefined),
      threadId: () => latest.current.threadId,
    });
  }, [enabled, state.paused]);

  if (!enabled) return null;
  const target = state.cursor ?? state.flash;
  return (
    <>
      {createPortal(
        <div {...scopeProps} data-vim-ui="">
          {values?.showModeIndicator === false ? null : <ModeIndicator state={state} />}
          {target === null ? null : <Ring target={target} />}
          {state.hints === null ? null : <Hints hints={state.hints} typed={state.typed} />}
        </div>,
        document.body,
      )}
      <Help open={state.help} />
    </>
  );
}
