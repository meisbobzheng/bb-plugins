import { useState } from "react";
import { Pencil, Plus, Trash } from "lucide-react";
import type { BoardSummary } from "../model";
import { cn } from "@/lib/utils";
import { ToolbarButton } from "./Toolbar";

const relativeTime = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

function formatUpdated(iso: string): string {
  const seconds = (Date.parse(iso) - Date.now()) / 1000;
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relativeTime.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

export function InlineRename({
  value,
  onSubmit,
  onCancel,
  className,
}: {
  value: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const submit = () => {
    const name = draft.trim();
    if (name === "" || name === value) onCancel();
    else onSubmit(name);
  };
  return (
    <input
      autoFocus
      value={draft}
      maxLength={120}
      aria-label="Board name"
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={submit}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") submit();
        if (event.key === "Escape") onCancel();
      }}
      className={cn(
        "h-7 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring",
        className,
      )}
    />
  );
}

export function BoardList({
  boards,
  activeId,
  renamingId,
  onSelect,
  onCreate,
  onRenameStart,
  onRename,
  onRenameEnd,
  onDelete,
}: {
  boards: readonly BoardSummary[];
  activeId: string | null;
  renamingId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRenameStart: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onRenameEnd: () => void;
  onDelete: (id: string) => void;
}) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  return (
    <nav aria-label="Boards" className="flex h-full w-48 shrink-0 flex-col border-r border-border bg-sidebar/40">
      <div className="flex h-9 items-center justify-between px-2 pl-3">
        <span className="text-xs font-medium text-muted-foreground">Boards</span>
        <ToolbarButton label="New board" onClick={onCreate}>
          <Plus className="size-4" />
        </ToolbarButton>
      </div>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1.5 pb-2">
        {boards.map((board) => (
          <li key={board.id} className="group relative">
            {renamingId === board.id ? (
              <div className="p-0.5">
                <InlineRename
                  value={board.name}
                  onSubmit={(name) => {
                    onRename(board.id, name);
                    onRenameEnd();
                  }}
                  onCancel={onRenameEnd}
                />
              </div>
            ) : confirmingId === board.id ? (
              <div
                className="flex items-center gap-1 rounded-md bg-state-hover px-2 py-1.5 text-xs"
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  event.preventDefault();
                  setConfirmingId(null);
                }}
              >
                <span className="min-w-0 flex-1 truncate">Delete?</span>
                <button
                  type="button"
                  aria-label={`Delete ${board.name}`}
                  className="rounded px-1.5 py-0.5 font-medium text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  onClick={() => {
                    setConfirmingId(null);
                    onDelete(board.id);
                  }}
                >
                  Delete
                </button>
                <button
                  type="button"
                  autoFocus
                  className="rounded px-1.5 py-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  onClick={() => setConfirmingId(null)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  title={board.name}
                  aria-current={board.id === activeId ? "true" : undefined}
                  onClick={() => onSelect(board.id)}
                  onDoubleClick={() => onRenameStart(board.id)}
                  className={cn(
                    "flex w-full flex-col items-start rounded-md px-2 py-1.5 pr-14 text-left hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    board.id === activeId && "bg-state-active",
                  )}
                >
                  <span className="w-full truncate text-sm text-foreground">{board.name}</span>
                  <span className="w-full truncate text-xs text-muted-foreground">
                    {formatUpdated(board.updatedAt)}
                  </span>
                </button>
                <div className="absolute right-1 top-1/2 hidden -translate-y-1/2 group-focus-within:flex group-hover:flex">
                  <ToolbarButton label={`Rename ${board.name}`} onClick={() => onRenameStart(board.id)}>
                    <Pencil className="size-3.5" />
                  </ToolbarButton>
                  <ToolbarButton label={`Delete ${board.name}`} onClick={() => setConfirmingId(board.id)}>
                    <Trash className="size-3.5" />
                  </ToolbarButton>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
