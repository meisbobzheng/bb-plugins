import { useEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type ITheme } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
  experimental_usePluginId,
  useBbContext,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { usePortalScopeProps } from "@/lib/portal-scope";
import { cn } from "@/lib/utils";
import {
  clampRect,
  defaultRect,
  floating,
  parseRect,
  useFloating,
  type Rect,
} from "./floating";
import { resolveScope, startSession, type Session } from "./session";

const ANSI = [
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow",
  "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
] as const;

interface Instance {
  terminal: Terminal;
  fit: FitAddon;
  session: Session | null;
}

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

function themeFrom(probe: HTMLElement): ITheme {
  const color = (variable: string) => {
    probe.style.color = `var(${variable})`;
    return getComputedStyle(probe).color;
  };
  const theme: ITheme = {
    background: color("--background"),
    foreground: color("--foreground"),
    cursor: color("--foreground"),
    selectionBackground: color("--state-active"),
  };
  ANSI.forEach((name, index) => {
    theme[name] = color(`--ansi-${index}`);
  });
  return theme;
}

function isToggleKey(event: KeyboardEvent) {
  return event.type === "keydown" && event.ctrlKey && !event.metaKey && event.key === "`";
}

const shortPath = (path: string) => path.replace(/^\/(Users|home)\/[^/]+/, "~");

export function FloatingTerminal() {
  const { open, place } = useFloating();
  const context = useBbContext();
  const sdk = useSdk();
  const pluginId = experimental_usePluginId();
  const scopeProps = usePortalScopeProps();
  const storageKey = `${pluginId}:floating-rect`;
  const [alive, setAlive] = useState(false);
  const [title, setTitle] = useState("Terminal");
  const [rect, setRect] = useState<Rect>(() =>
    clampRect(parseRect(localStorage.getItem(storageKey)) ?? defaultRect(viewport()), viewport()),
  );
  const windowRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const instance = useRef<Instance | null>(null);
  const returnFocus = useRef<Element | null>(null);

  const save = (next: Rect) => localStorage.setItem(storageKey, JSON.stringify(next));

  const end = () => {
    const current = instance.current;
    instance.current = null;
    current?.session?.dispose();
    current?.terminal.dispose();
    setAlive(false);
    setTitle("Terminal");
    floating.hide();
  };

  const closeTerminal = () => {
    const session = instance.current?.session;
    end();
    session?.close().catch(() => undefined);
  };

  useEffect(() => {
    if (open) setAlive(true);
  }, [open]);

  useEffect(() => {
    const current = instance.current;
    if (!open) {
      current?.session?.setVisible(false);
      const target = returnFocus.current;
      returnFocus.current = null;
      if (target instanceof HTMLElement && target.isConnected) target.focus();
      return;
    }
    returnFocus.current = document.activeElement;
    if (current) {
      current.session?.setVisible(true);
      requestAnimationFrame(() => {
        current.fit.fit();
        current.terminal.focus();
      });
      return;
    }
    const body = bodyRef.current;
    if (!alive || !body) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--font-terminal").trim() || "monospace",
      fontSize: 13,
      scrollback: 5000,
      theme: themeFrom(body),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(body);
    fit.fit();
    terminal.focus();
    const started: Instance = { terminal, fit, session: null };
    instance.current = started;
    terminal.attachCustomKeyEventHandler((event) => {
      if (!isToggleKey(event)) return true;
      floating.hide();
      return false;
    });

    const where = place ?? { threadId: context.threadId, projectId: context.projectId };
    resolveScope(sdk, where)
      .then((scope) =>
        sdk.terminals.create({ scope, cols: terminal.cols, rows: terminal.rows, title: "Floating terminal" }),
      )
      .then((created) => {
        if (instance.current !== started) {
          sdk.terminals.close({ terminalId: created.id, mode: "force" }).catch(() => undefined);
          return;
        }
        setTitle(shortPath(created.initialCwd));
        const session = startSession(sdk, created.id, {
          write: (data) => terminal.write(data),
          exit: () => {
            if (instance.current === started) end();
          },
        });
        started.session = session;
        session.setVisible(floating.get().open);
        terminal.onData((data) => session.send(data));
        terminal.onResize(({ cols, rows }) => session.resize(cols, rows));
      })
      .catch((error: unknown) => {
        if (instance.current === started) end();
        toast.error(error instanceof Error ? error.message : String(error));
      });
  }, [open, alive]);

  useEffect(() => {
    const element = windowRef.current;
    if (!alive || !element) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!floating.get().open) return;
        instance.current?.fit.fit();
        const { width, height } = element.getBoundingClientRect();
        setRect((current) => {
          const next = { ...current, width: Math.round(width), height: Math.round(height) };
          save(next);
          return next;
        });
      });
    });
    observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [alive]);

  useEffect(() => () => {
    instance.current?.session?.dispose();
    instance.current?.terminal.dispose();
  }, []);

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as Element).closest("button")) return;
    event.preventDefault();
    const header = event.currentTarget;
    const origin = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    header.setPointerCapture(event.pointerId);
    const move = (moveEvent: globalThis.PointerEvent) =>
      setRect((current) =>
        clampRect(
          { ...current, left: origin.left + moveEvent.clientX - origin.x, top: origin.top + moveEvent.clientY - origin.y },
          viewport(),
        ),
      );
    const stop = () => {
      header.removeEventListener("pointermove", move);
      setRect((current) => {
        save(current);
        return current;
      });
    };
    header.addEventListener("pointermove", move);
    header.addEventListener("lostpointercapture", stop, { once: true });
  };

  if (!alive) return null;

  return createPortal(
    <div
      {...scopeProps}
      ref={windowRef}
      role="dialog"
      aria-label="Floating terminal"
      aria-modal="false"
      data-panel-dock-floating=""
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      className={cn(
        "fixed z-50 min-h-[200px] min-w-[360px] resize flex-col overflow-hidden rounded-xl border border-border bg-background shadow-lg",
        open ? "flex" : "hidden",
      )}
    >
      <div
        onPointerDown={startDrag}
        onDoubleClick={() => {
          const next = clampRect(defaultRect(viewport()), viewport());
          setRect(next);
          save(next);
        }}
        className="flex h-8 shrink-0 cursor-grab items-center gap-2 border-b border-border px-3 text-xs text-muted-foreground active:cursor-grabbing"
      >
        <Icon name="Terminal" className="size-3.5" />
        <span className="min-w-0 flex-1 truncate font-mono" title={title}>
          {title}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label="Hide terminal (Ctrl+`)"
          onClick={floating.hide}
        >
          <Icon name="Minus" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label="Close terminal"
          onClick={closeTerminal}
        >
          <Icon name="X" />
        </Button>
      </div>
      <div ref={bodyRef} className="min-h-0 flex-1 px-2 pb-1 pt-2" />
    </div>,
    document.body,
  );
}
