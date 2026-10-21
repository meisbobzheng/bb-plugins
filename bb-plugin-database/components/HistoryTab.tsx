import { useEffect, useState } from "react";
import { experimental_copyToClipboard as copyToClipboard, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { HistoryEntry } from "../contract";
import { cn } from "../lib/utils";
import { Confirm, EmptyState, IconButton, SourceBadge, Spinner, formatCount, formatMs, relativeTime } from "./bits";
import { errorMessage, useChanged, useDbRpc, useSessionSync } from "./hooks";
import { editorRequests } from "./requests";
import { activeConnection } from "./session";
import { Icon } from "./ui/icon";
import { Input } from "./ui/input";

const SEARCH_DEBOUNCE_MS = 150;

export function HistoryRow({ entry, showConnection }: { entry: HistoryEntry; showConnection: boolean }) {
  const load = (run: boolean) => {
    if (!editorRequests.emit({ sql: entry.sql, run })) toast.error("Open the Database page to load a query.");
  };
  return (
    <li className="group border-b border-border">
      <div className="flex items-start gap-2 px-3 py-2 hover:bg-state-hover">
        <button type="button" onClick={() => load(false)} className="min-w-0 flex-1 text-left" title="Load into the editor">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            <span title={entry.startedAt}>{relativeTime(entry.startedAt)}</span>
            <SourceBadge source={entry.source} />
            {showConnection ? (
              <span className="truncate">
                {entry.connectionName} · <span className="font-mono">{entry.database}</span>
              </span>
            ) : null}
            <span className="flex-1" />
            {entry.error === null ? (
              <span className="tabular-nums">
                {entry.rowCount === null ? "" : `${formatCount(entry.rowCount, "row")} · `}
                {formatMs(entry.durationMs)}
              </span>
            ) : (
              <span className="text-destructive" title={entry.error}>
                error
              </span>
            )}
          </div>
          {entry.prompt === null ? null : (
            <p className="mt-0.5 line-clamp-1 text-xs italic text-muted-foreground" title={entry.prompt}>
              “{entry.prompt}”
            </p>
          )}
          <pre className={cn("mt-0.5 line-clamp-3 whitespace-pre-wrap break-words font-mono text-[11px]", entry.error !== null && "opacity-70")}>{entry.sql}</pre>
        </button>
        <span className="hidden shrink-0 flex-col gap-0.5 group-hover:flex">
          <IconButton label="Run again" icon="Play" onClick={() => load(true)} className="h-6 w-6 px-0" />
          <IconButton label="Copy SQL" icon="Copy" onClick={() => void copyToClipboard({ text: entry.sql }).then((ok) => (ok ? toast.success("Copied SQL") : toast.error("Could not copy")))} className="h-6 w-6 px-0" />
        </span>
      </div>
    </li>
  );
}

export function HistoryTab(_props: PluginNavPanelProps) {
  const rpc = useDbRpc();
  const session = useSessionSync();
  const connection = activeConnection(session);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [all, setAll] = useState(false);
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [version, setVersion] = useState(0);
  useChanged(["history", "connections"], () => setVersion((value) => value + 1));

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const connectionId = all ? null : (connection?.id ?? null);
  useEffect(() => {
    let live = true;
    rpc.call("history_list", { connectionId, query: debounced, limit: 200 }).then(
      ({ entries: next }) => {
        if (live) {
          setEntries(next);
          setError(null);
        }
      },
      (cause: unknown) => {
        if (live) setError(errorMessage(cause));
      },
    );
    return () => {
      live = false;
    };
  }, [rpc, connectionId, debounced, version]);

  const clear = async () => {
    setConfirmClear(false);
    try {
      const { removed } = await rpc.call("history_clear", { connectionId });
      toast.success(removed === 1 ? "Cleared 1 entry" : `Cleared ${removed} entries`);
    } catch (cause) {
      toast.error(errorMessage(cause));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b border-border p-2">
        <div className="relative min-w-0 flex-1">
          <Icon name="Search" className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search history" aria-label="Search history" className="h-7 pl-7 text-xs" />
        </div>
        <IconButton label={all ? "Showing every connection" : "Showing the active connection"} icon={all ? "Globe" : "database/database"} pressed={all} onClick={() => setAll((value) => !value)} />
        <IconButton label="Clear history" icon="Trash2" onClick={() => setConfirmClear(true)} disabled={entries === null || entries.length === 0} />
      </div>
      {confirmClear ? (
        <div className="border-b border-border p-3">
          <Confirm
            title={all ? "Clear all history?" : `Clear history for ${connection?.name ?? "this connection"}?`}
            body="This removes the entries shown here and cannot be undone."
            confirmLabel="Clear"
            destructive
            onConfirm={() => void clear()}
            onCancel={() => setConfirmClear(false)}
          />
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        {entries === null ? (
          <div className="flex items-center justify-center gap-2 p-4 text-xs text-muted-foreground">
            <Spinner /> Loading…
          </div>
        ) : error !== null ? (
          <p role="alert" className="m-3 text-xs text-destructive">
            {error}
          </p>
        ) : entries.length === 0 ? (
          <EmptyState className="m-3 text-xs">{query === "" ? "Queries you run appear here." : "No history matches."}</EmptyState>
        ) : (
          <ul>
            {entries.map((entry) => (
              <HistoryRow key={entry.id} entry={entry} showConnection={all} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
