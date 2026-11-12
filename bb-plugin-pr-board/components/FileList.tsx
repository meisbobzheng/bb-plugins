import { useState } from "react";
import type { FileStatus, PullFile } from "../contract";
import { cn } from "../lib/utils";
import { Icon } from "./ui/icon";
import { Input } from "./ui/input";
import { usePreference } from "./use-preference";

const STATUS: Record<FileStatus, { letter: string; className: string }> = {
  added: { letter: "A", className: "text-diff-added" },
  removed: { letter: "D", className: "text-diff-removed" },
  modified: { letter: "M", className: "text-warning-text" },
  renamed: { letter: "R", className: "text-file-accent" },
  copied: { letter: "C", className: "text-file-accent" },
  changed: { letter: "M", className: "text-warning-text" },
  unchanged: { letter: "·", className: "text-muted-foreground" },
};

export interface FileCounts {
  findings: ReadonlyMap<string, number>;
  waiting: ReadonlyMap<string, number>;
  threads: ReadonlyMap<string, number>;
  drafts: ReadonlyMap<string, number>;
}

function Count({ value, className, title }: { value: number | undefined; className: string; title: string }) {
  if (value === undefined || value === 0) return null;
  return (
    <span className={cn("rounded px-1 text-[10px] font-semibold tabular-nums", className)} title={title}>
      {value}
    </span>
  );
}

export function ViewedBox({ viewed, className }: { viewed: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border-[1.5px]",
        viewed ? "border-success bg-success text-background" : "border-muted-foreground/70",
        className,
      )}
    >
      {viewed ? <Icon name="Check" className="size-2.5" /> : null}
    </span>
  );
}

function directoryOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

function FileRow({ file, selected, counts, onSelect, onToggleViewed }: { file: PullFile; selected: boolean; counts: FileCounts; onSelect(): void; onToggleViewed(): void }) {
  const status = STATUS[file.status];
  return (
    <li className="relative">
      <button
        type="button"
        onClick={onToggleViewed}
        aria-pressed={file.viewed}
        aria-label={file.viewed ? `Mark ${file.path} as not viewed` : `Mark ${file.path} as viewed`}
        title={file.viewed ? "Viewed" : "Mark as viewed"}
        className="absolute left-1 top-1/2 -translate-y-1/2 rounded p-1 outline-none hover:bg-state-hover focus-visible:ring-1 focus-visible:ring-ring"
      >
        <ViewedBox viewed={file.viewed} />
      </button>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        title={file.previousPath === null ? file.path : `${file.previousPath} → ${file.path}`}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-md py-1 pl-7 pr-2 text-left text-xs outline-none hover:bg-state-hover focus-visible:ring-1 focus-visible:ring-ring",
          selected && "bg-state-active",
        )}
      >
        <span className={cn("w-3 shrink-0 text-center font-mono font-semibold", status.className)}>{status.letter}</span>
        <span className={cn("min-w-0 flex-1 truncate font-medium", file.viewed && "text-muted-foreground line-through decoration-muted-foreground/40")}>
          {file.path.slice(file.path.lastIndexOf("/") + 1)}
        </span>
        <Count value={counts.findings.get(file.path)} className="bg-warning/20 text-warning-text" title="Review findings" />
        <Count value={counts.waiting.get(file.path)} className="bg-destructive/15 text-destructive-text" title="Comments waiting for your reply" />
        <Count value={counts.threads.get(file.path)} className="bg-timeline-accent/15 text-timeline-accent" title="Other unresolved comment threads" />
        <Count value={counts.drafts.get(file.path)} className="bg-violet-500/15 text-violet-700 dark:text-violet-300" title="Pending comments" />
      </button>
    </li>
  );
}

export function FileList({
  files,
  selectedPath,
  counts,
  onSelectFile,
  onToggleViewed,
}: {
  files: readonly PullFile[];
  selectedPath: string | null;
  counts: FileCounts;
  onSelectFile(path: string): void;
  onToggleViewed(file: PullFile): void;
}) {
  const [filter, setFilter] = useState("");
  const [hideViewed, setHideViewed] = usePreference<boolean>("hide-viewed", false);
  const query = filter.trim().toLowerCase();
  const shown = files.filter((file) => file.path.toLowerCase().includes(query) && (!hideViewed || !file.viewed || file.path === selectedPath));
  const viewed = files.filter((file) => file.viewed).length;
  const groups = new Map<string, PullFile[]>();
  for (const file of shown) groups.set(directoryOf(file.path), [...(groups.get(directoryOf(file.path)) ?? []), file]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 border-b border-border p-2.5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold">Files</span>
          <span className="tabular-nums text-muted-foreground">
            {viewed} of {files.length} viewed
          </span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Files viewed" aria-valuemin={0} aria-valuemax={files.length} aria-valuenow={viewed}>
          <div className="h-full rounded-full bg-success transition-[width]" style={{ width: `${files.length === 0 ? 0 : (viewed / files.length) * 100}%` }} />
        </div>
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && filter.length > 0) {
              event.stopPropagation();
              setFilter("");
            }
          }}
          placeholder="Filter files"
          aria-label="Filter files"
          title="Esc clears the filter"
          className="h-7 text-xs"
        />
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
          <input type="checkbox" checked={hideViewed} onChange={(event) => setHideViewed(event.target.checked)} />
          Hide viewed files
        </label>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {shown.length === 0 && files.length > 0 ? (
          <li className="px-2 py-6 text-center text-xs text-muted-foreground">
            {query.length > 0 ? `No changed file matches “${filter.trim()}”.` : "Every file is viewed."}
          </li>
        ) : null}
        {[...groups].map(([directory, list]) => (
          <li key={directory}>
            {directory.length === 0 ? null : <p className="truncate px-2 pb-0.5 pt-2 font-mono text-[11px] text-muted-foreground">{directory}/</p>}
            <ul>
              {list.map((file) => (
                <FileRow
                  key={file.path}
                  file={file}
                  selected={file.path === selectedPath}
                  counts={counts}
                  onSelect={() => onSelectFile(file.path)}
                  onToggleViewed={() => onToggleViewed(file)}
                />
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
