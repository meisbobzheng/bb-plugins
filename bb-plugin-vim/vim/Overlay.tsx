import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useBbContext, useBbNavigate, useSettings } from "@get-bb/plugin-sdk/app";
import { usePortalScopeProps } from "@/lib/portal-scope";
import { mountVim } from "./engine";
import { Help } from "./Help";
import { useVimState, type Hint, type VimState } from "./store";

const LAYER = "pointer-events-none fixed z-[2147483647]";

function Ring({ target }: { target: Element }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const paint = () => {
      const box = target.getBoundingClientRect();
      const ring = ref.current;
      if (ring !== null) {
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
        style={{ left: Math.max(hint.box.left, 0), top: Math.max(hint.box.top, 0) }}
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
  return (
    <div
      data-vim-mode=""
      className={`${LAYER} bottom-1.5 right-2 rounded bg-muted/90 px-1.5 font-mono text-[10px] font-semibold leading-4 tracking-wide text-muted-foreground`}
    >
      {modeLabel(state)}
      {state.pending === "" ? null : <span className="ml-1.5 text-foreground">{state.pending}</span>}
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
          {target === null ? null : <Ring target={target} />}
          {state.hints === null ? null : <Hints hints={state.hints} typed={state.typed} />}
          {values?.showModeIndicator === false ? null : <ModeIndicator state={state} />}
        </div>,
        document.body,
      )}
      <Help open={state.help} />
    </>
  );
}
