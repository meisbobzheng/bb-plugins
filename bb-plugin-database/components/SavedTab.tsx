import { useEffect, useMemo, useState } from "react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { SavedQuery } from "../contract";
import { EmptyState, IconButton, Spinner, relativeTime } from "./bits";
import { errorMessage, useChanged, useDbRpc, useSessionSync } from "./hooks";
import { editorRequests } from "./requests";
import { SaveQueryDialog } from "./SaveQueryDialog";
import { activeConnection } from "./session";
import { Icon } from "./ui/icon";
import { Input } from "./ui/input";

export function filterSaved(queries: readonly SavedQuery[], query: string): SavedQuery[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term !== "");
  return queries.filter((saved) => terms.every((term) => `${saved.name} ${saved.sql}`.toLowerCase().includes(term)));
}

function SavedRow({ saved, scoped, onEdit, onDelete }: { saved: SavedQuery; scoped: boolean; onEdit(): void; onDelete(): void }) {
  const [confirm, setConfirm] = useState(false);
  const load = (run: boolean) => {
    if (!editorRequests.emit({ sql: saved.sql, run })) toast.error("Open the Database page to load a query.");
  };
  return (
    <li className="group border-b border-border">
      <div className="flex items-start gap-2 px-3 py-2 hover:bg-state-hover">
        <button type="button" onClick={() => load(false)} className="min-w-0 flex-1 text-left" title="Load into the editor">
          <div className="flex items-center gap-2 text-xs">
            <Icon name={scoped ? "Star" : "Globe"} className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate font-medium">{saved.name}</span>
            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground" title={saved.updatedAt}>
              {relativeTime(saved.updatedAt)}
            </span>
          </div>
          <pre className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">{saved.sql}</pre>
        </button>
        <span className="hidden shrink-0 flex-col gap-0.5 group-hover:flex">
          <IconButton label="Run" icon="Play" onClick={() => load(true)} className="h-6 w-6 px-0" />
          <IconButton label="Rename or update" icon="Edit" onClick={onEdit} className="h-6 w-6 px-0" />
          <IconButton label={confirm ? "Confirm delete" : "Delete"} icon={confirm ? "Check" : "Trash2"} onClick={() => (confirm ? onDelete() : setConfirm(true))} className={confirm ? "h-6 w-6 px-0 text-destructive" : "h-6 w-6 px-0"} />
        </span>
      </div>
    </li>
  );
}

export function SavedTab(_props: PluginNavPanelProps) {
  const rpc = useDbRpc();
  const session = useSessionSync();
  const connection = activeConnection(session);
  const [query, setQuery] = useState("");
  const [queries, setQueries] = useState<SavedQuery[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SavedQuery | null>(null);
  const [version, setVersion] = useState(0);
  useChanged(["saved", "connections"], () => setVersion((value) => value + 1));

  const connectionId = connection?.id ?? null;
  useEffect(() => {
    let live = true;
    rpc.call("saved_list", { connectionId }).then(
      ({ queries: next }) => {
        if (live) {
          setQueries(next);
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
  }, [rpc, connectionId, version]);

  const shown = useMemo(() => filterSaved(queries ?? [], query), [queries, query]);

  const remove = async (saved: SavedQuery) => {
    try {
      await rpc.call("saved_delete", { id: saved.id });
      toast.success(`Deleted “${saved.name}”`);
    } catch (cause) {
      toast.error(errorMessage(cause));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b border-border p-2">
        <div className="relative min-w-0 flex-1">
          <Icon name="Search" className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search saved queries" aria-label="Search saved queries" className="h-7 pl-7 text-xs" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {queries === null ? (
          <div className="flex items-center justify-center gap-2 p-4 text-xs text-muted-foreground">
            <Spinner /> Loading…
          </div>
        ) : error !== null ? (
          <p role="alert" className="m-3 text-xs text-destructive">
            {error}
          </p>
        ) : shown.length === 0 ? (
          <EmptyState className="m-3 text-xs">{query === "" ? "Save a query from the toolbar and it appears here." : "No saved queries match."}</EmptyState>
        ) : (
          <ul>
            {shown.map((saved) => (
              <SavedRow key={saved.id} saved={saved} scoped={saved.connectionId !== null} onEdit={() => setEditing(saved)} onDelete={() => void remove(saved)} />
            ))}
          </ul>
        )}
      </div>
      {connection === null || editing === null ? null : (
        <SaveQueryDialog open sql={editing.sql} connectionId={connection.id} existing={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
