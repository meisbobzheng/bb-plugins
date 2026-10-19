import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { experimental_usePluginId, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { AtSign, Maximize2, Minimize2, PanelLeft, X } from "lucide-react";
import { toast } from "sonner";
import type { rpcContract } from "../server";
import { BOARDS_CHANGED } from "../constants";
import type { Board, BoardSummary } from "../model";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { cn } from "@/lib/utils";
import { BoardList, InlineRename } from "./BoardList";
import { Editor, waitForSave } from "./Editor";
import { ToolbarButton } from "./Toolbar";
import { scratchpad, useScratchpad, type ActiveBoard } from "./store";

interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Layout {
  frame: Frame;
  maximized: boolean;
  showBoards: boolean;
}

const MIN_W = 460;
const MIN_H = 320;
const EDGE = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function clampFrame({ x, y, w, h }: Frame): Frame {
  const width = clamp(w, MIN_W, window.innerWidth - EDGE * 2);
  const height = clamp(h, MIN_H, window.innerHeight - EDGE * 2);
  return {
    x: clamp(x, EDGE - width + 160, window.innerWidth - 160),
    y: clamp(y, EDGE, window.innerHeight - 48),
    w: width,
    h: height,
  };
}

function defaultLayout(): Layout {
  const w = Math.min(880, window.innerWidth - 48);
  const h = Math.min(600, window.innerHeight - 96);
  return {
    frame: clampFrame({ x: window.innerWidth - w - 24, y: 64, w, h }),
    maximized: false,
    showBoards: true,
  };
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

function useLayout(storageKey: string) {
  const [layout, setLayout] = useState<Layout>(() => {
    const stored = readJson<Layout>(storageKey);
    return stored === null ? defaultLayout() : { ...stored, frame: clampFrame(stored.frame) };
  });
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(layout));
  }, [storageKey, layout]);
  useEffect(() => {
    const onResize = () => setLayout((current) => ({ ...current, frame: clampFrame(current.frame) }));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return [layout, setLayout] as const;
}

function useBoards() {
  const rpc = useRpc<typeof rpcContract>();
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const refresh = useCallback(() => {
    rpc.call("boards_list").then(
      ({ boards: next }) => setBoards(next),
      (cause: unknown) =>
        toast.error("Scratchpad: could not load boards", {
          description: cause instanceof Error ? cause.message : String(cause),
        }),
    );
  }, [rpc]);
  useEffect(refresh, [refresh]);
  useRealtime(BOARDS_CHANGED, refresh);
  return { rpc, boards, refresh };
}

function useBoard(boardId: string | null) {
  const rpc = useRpc<typeof rpcContract>();
  const [board, setBoard] = useState<Board | null>(null);
  useEffect(() => {
    if (boardId === null) return;
    let cancelled = false;
    setBoard(null);
    waitForSave(boardId)
      .then(() => rpc.call("board_get", { id: boardId }))
      .then(
        ({ board: next }) => {
          if (!cancelled) setBoard(next);
        },
        (cause: unknown) =>
          toast.error("Scratchpad: could not open board", {
            description: cause instanceof Error ? cause.message : String(cause),
          }),
      );
    return () => {
      cancelled = true;
    };
  }, [rpc, boardId]);
  return board?.id === boardId ? board : null;
}

function useDrag(onMove: (dx: number, dy: number) => void) {
  const origin = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 || (event.target as HTMLElement).closest("button, input")) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      origin.current = { x: event.clientX, y: event.clientY };
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      if (origin.current === null) return;
      onMove(event.clientX - origin.current.x, event.clientY - origin.current.y);
      origin.current = { x: event.clientX, y: event.clientY };
    },
    onPointerUp: () => {
      origin.current = null;
    },
  };
}

function ScratchpadWindow({ open, pluginId }: { open: boolean; pluginId: string }) {
  const compact = useIsCompactViewport();
  const [layout, setLayout] = useLayout(`${pluginId}:layout`);
  const { rpc, boards, refresh } = useBoards();
  const { activeBoard } = useScratchpad();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const activeId = activeBoard?.id ?? null;
  const board = useBoard(activeId);

  useEffect(() => {
    if (boards === null) return;
    const current = boards.find((candidate) => candidate.id === activeId) ?? boards[0];
    const next: ActiveBoard | null = current === undefined ? null : { id: current.id, name: current.name };
    if (next?.id !== activeBoard?.id || next?.name !== activeBoard?.name) scratchpad.setActiveBoard(next);
  }, [boards, activeId, activeBoard]);

  useEffect(() => {
    if (open) rootRef.current?.querySelector<HTMLElement>("[data-scratchpad-canvas]")?.focus({ preventScroll: true });
  }, [open, board]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      const focused = document.activeElement;
      const lost = focused === null || focused === document.body || rootRef.current?.contains(focused);
      if (lost && previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open]);

  const moveFrame = useDrag((dx, dy) =>
    setLayout((current) => ({
      ...current,
      frame: clampFrame({ ...current.frame, x: current.frame.x + dx, y: current.frame.y + dy }),
    })),
  );
  const resizeFrame = useDrag((dx, dy) =>
    setLayout((current) => ({
      ...current,
      frame: clampFrame({ ...current.frame, w: current.frame.w + dx, h: current.frame.h + dy }),
    })),
  );

  const report = (message: string) => (cause: unknown) =>
    toast.error(message, { description: cause instanceof Error ? cause.message : String(cause) });

  const createBoard = () => {
    const name = `Board ${(boards?.length ?? 0) + 1}`;
    rpc.call("board_create", { name }).then((created) => {
      scratchpad.setActiveBoard({ id: created.id, name: created.name });
      setLayout((current) => ({ ...current, showBoards: true }));
      setRenamingId(created.id);
      refresh();
    }, report("Scratchpad: could not create a board"));
  };
  const renameBoard = (id: string, name: string) => {
    rpc.call("board_rename", { id, name }).then(refresh, report("Scratchpad: could not rename the board"));
  };
  const deleteBoard = (id: string) => {
    rpc.call("board_delete", { id }).then(refresh, report("Scratchpad: could not delete the board"));
  };

  const floating = !compact && !layout.maximized;
  const { frame } = layout;

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Scratchpad"
      aria-modal={false}
      tabIndex={-1}
      hidden={!open}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          scratchpad.close();
        }
      }}
      className={cn(
        "fixed z-40 flex flex-col overflow-hidden outline-none border border-border bg-background text-foreground shadow-2xl",
        compact ? "inset-0" : layout.maximized ? "inset-4 rounded-xl" : "rounded-xl",
        !open && "hidden",
      )}
      style={floating ? { left: frame.x, top: frame.y, width: frame.w, height: frame.h } : undefined}
    >
      <header
        className={cn(
          "flex h-10 shrink-0 select-none items-center gap-1 border-b border-border px-1.5",
          floating && "cursor-grab active:cursor-grabbing",
        )}
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).closest("button, input, [data-board-title]")) return;
          setLayout((current) => ({ ...current, maximized: !current.maximized }));
        }}
        {...(floating ? moveFrame : {})}
      >
        <ToolbarButton
          label={layout.showBoards ? "Hide boards" : "Show boards"}
          active={layout.showBoards}
          onClick={() => setLayout((current) => ({ ...current, showBoards: !current.showBoards }))}
        >
          <PanelLeft className="size-4" />
        </ToolbarButton>
        <div className="min-w-0 flex-1 px-1">
          {activeBoard !== null && renamingTitle ? (
            <InlineRename
              className="max-w-64"
              value={activeBoard.name}
              onSubmit={(name) => {
                renameBoard(activeBoard.id, name);
                setRenamingTitle(false);
              }}
              onCancel={() => setRenamingTitle(false)}
            />
          ) : (
            <span
              data-board-title=""
              title="Double-click to rename"
              className="block truncate text-sm font-medium"
              onDoubleClick={() => setRenamingTitle(activeBoard !== null)}
            >
              {activeBoard?.name ?? "Scratchpad"}
            </span>
          )}
        </div>
        <span
          className="hidden items-center gap-1 whitespace-nowrap pr-1 text-xs text-muted-foreground sm:flex"
          title="Type @ in a thread composer and pick this board, or use + → Mention scratchpad board"
        >
          <AtSign className="size-3.5" />
          to mention in a thread
        </span>
        {compact ? null : (
          <ToolbarButton
            label={layout.maximized ? "Restore window" : "Maximize window"}
            onClick={() => setLayout((current) => ({ ...current, maximized: !current.maximized }))}
          >
            {layout.maximized ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </ToolbarButton>
        )}
        <ToolbarButton label="Close scratchpad — Esc" onClick={scratchpad.close}>
          <X className="size-4" />
        </ToolbarButton>
      </header>
      <div className="flex min-h-0 flex-1">
        {layout.showBoards && boards !== null ? (
          <BoardList
            boards={boards}
            activeId={activeId}
            renamingId={renamingId}
            onSelect={(id) => {
              const target = boards.find((candidate) => candidate.id === id);
              if (target) scratchpad.setActiveBoard({ id: target.id, name: target.name });
            }}
            onCreate={createBoard}
            onRenameStart={setRenamingId}
            onRename={renameBoard}
            onRenameEnd={() => setRenamingId(null)}
            onDelete={deleteBoard}
          />
        ) : null}
        <main className="relative min-w-0 flex-1">
          {board === null ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading board…</div>
          ) : (
            <Editor key={board.id} board={board} />
          )}
        </main>
      </div>
      {floating ? (
        <div
          aria-hidden
          className="absolute bottom-0 right-0 size-4 cursor-nwse-resize"
          {...resizeFrame}
        />
      ) : null}
    </div>
  );
}

export function ScratchpadOverlay() {
  const { open, activeBoard } = useScratchpad();
  const pluginId = experimental_usePluginId();
  const [mounted, setMounted] = useState(false);
  const storageKey = `${pluginId}:active-board`;

  useEffect(() => {
    const stored = readJson<ActiveBoard>(storageKey);
    if (stored !== null && scratchpad.get().activeBoard === null) scratchpad.setActiveBoard(stored);
  }, [storageKey]);

  useEffect(() => {
    if (activeBoard !== null) localStorage.setItem(storageKey, JSON.stringify(activeBoard));
  }, [storageKey, activeBoard]);

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  return mounted ? <ScratchpadWindow open={open} pluginId={pluginId} /> : null;
}
