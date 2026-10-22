import { useCallback, useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { experimental_useAppPanel as useAppPanel, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { AskResult, Connection, ExplainResult, QueryRun, TableInfo } from "../contract";
import { cn } from "../lib/utils";
import { HISTORY_TAB, SAVED_TAB } from "../panel";
import { qualifiedName } from "../sql";
import { EmptyState, Hint, IconButton, Kbd, Spinner } from "./bits";
import { ConnectionDialog } from "./ConnectionDialog";
import { Editor, type EditorHandle } from "./Editor";
import { errorMessage, useDbRpc, useLocalDraft, useSchema, useSessionSync, useStatus } from "./hooks";
import { PlanView } from "./Plan";
import { editorRequests } from "./requests";
import { Results } from "./Results";
import { SaveQueryDialog } from "./SaveQueryDialog";
import { SchemaBrowser } from "./SchemaBrowser";
import { activeConnection } from "./session";
import { TableDetail } from "./TableDetail";
import { Button } from "./ui/button";
import { Icon } from "./ui/icon";
import { Input } from "./ui/input";
import { useWidth } from "./use-width";

const EDITOR_HEIGHT_KEY = "database:editor-height";
const SCHEMA_WIDTH_KEY = "database:schema-width";
const SCHEMA_OPEN_KEY = "database:schema-open";
const MIN_EDITOR = 96;
const MIN_RESULTS = 160;
const MIN_SCHEMA = 180;
const MAX_SCHEMA = 480;
const SCHEMA_AUTO_WIDTH = 720;

function newQueryId(): string {
  return `qry_${Math.random().toString(36).slice(2, 10).padEnd(8, "0")}`;
}

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    return;
  }
}

function storedSize(key: string, fallback: number, min: number): number {
  const stored = Number(readStored(key));
  return Number.isFinite(stored) && stored >= min ? stored : fallback;
}

function storedFlag(key: string): boolean | null {
  const stored = readStored(key);
  return stored === null ? null : stored === "1";
}

function drag(event: ReactPointerEvent<HTMLElement>, onMove: (dx: number, dy: number) => void, onEnd: () => void): void {
  event.preventDefault();
  const { clientX, clientY } = event;
  const move = (next: PointerEvent) => onMove(next.clientX - clientX, next.clientY - clientY);
  const end = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    onEnd();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
}

function ToolLabel({ children }: { children: ReactNode }) {
  return <span className="hidden @md/toolbar:inline">{children}</span>;
}

type View = { kind: "results" } | { kind: "plan"; plan: ExplainResult; sql: string } | { kind: "table"; table: TableInfo };

interface AskState {
  prompt: string;
  busy: boolean;
  result: AskResult | null;
  error: string | null;
}

function Workbench({ connection }: { connection: Connection }) {
  const rpc = useDbRpc();
  const status = useStatus();
  const appPanel = useAppPanel();
  const editor = useRef<EditorHandle>(null);
  const [sql, setSql] = useLocalDraft(connection.id);
  const schema = useSchema(connection.id, connection.database);
  const [run, setRun] = useState<QueryRun | null>(null);
  const [ranSql, setRanSql] = useState("");
  const [runningId, setRunningId] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [view, setView] = useState<View>({ kind: "results" });
  const [ask, setAsk] = useState<AskState>({ prompt: "", busy: false, result: null, error: null });
  const [saveOpen, setSaveOpen] = useState(false);
  const [editorHeight, setEditorHeight] = useState(() => storedSize(EDITOR_HEIGHT_KEY, 220, MIN_EDITOR));
  const [schemaWidth, setSchemaWidth] = useState(() => storedSize(SCHEMA_WIDTH_KEY, 256, MIN_SCHEMA));
  const [schemaPinned, setSchemaPinned] = useState(() => storedFlag(SCHEMA_OPEN_KEY));
  const [rootRef, rootWidth] = useWidth<HTMLDivElement>();
  const column = useRef<HTMLDivElement>(null);
  const schemaOpen = schemaPinned ?? (rootWidth === null || rootWidth >= SCHEMA_AUTO_WIDTH);

  const execute = useCallback(
    async (text?: string) => {
      const statement = (text ?? editor.current?.selectionOrAll() ?? sql).trim();
      if (statement === "" || runningId !== null) return;
      const queryId = newQueryId();
      setRunningId(queryId);
      setRanSql(statement);
      setView({ kind: "results" });
      try {
        setRun(await rpc.call("query_run", { connectionId: connection.id, sql: statement, queryId }));
      } catch (cause) {
        setRun({
          id: queryId,
          results: [],
          error: { kind: "connection", message: errorMessage(cause), code: null, position: null, detail: null, hint: null },
          durationMs: 0,
          startedAt: new Date().toISOString(),
          readOnly: !connection.allowWrites,
        });
      } finally {
        setRunningId(null);
      }
    },
    [rpc, connection.id, connection.allowWrites, sql, runningId],
  );

  const explain = useCallback(
    async (analyze: boolean) => {
      const statement = (editor.current?.selectionOrAll() ?? sql).trim();
      if (statement === "" || explaining) return;
      setExplaining(true);
      try {
        const plan = await rpc.call("query_explain", { connectionId: connection.id, sql: statement, analyze });
        setView({ kind: "plan", plan, sql: statement });
      } catch (cause) {
        toast.error(errorMessage(cause));
      } finally {
        setExplaining(false);
      }
    },
    [rpc, connection.id, sql, explaining],
  );

  const cancel = useCallback(() => {
    if (runningId === null) return;
    void rpc.call("query_cancel", { queryId: runningId }).then(({ cancelled }) => {
      if (!cancelled) toast.error("The query had already finished.");
    });
  }, [rpc, runningId]);

  useEffect(() => {
    if (runningId === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runningId, cancel]);

  const latestExecute = useRef(execute);
  latestExecute.current = execute;
  useEffect(
    () =>
      editorRequests.subscribe(({ sql: next, run: shouldRun }) => {
        setSql(next);
        if (shouldRun) void latestExecute.current(next);
        else editor.current?.focus();
      }),
    [setSql],
  );

  const askNow = async (event: FormEvent) => {
    event.preventDefault();
    const prompt = ask.prompt.trim();
    if (prompt === "" || ask.busy) return;
    setAsk((current) => ({ ...current, busy: true, error: null }));
    try {
      const result = await rpc.call("ask", { connectionId: connection.id, prompt, currentSql: sql.trim() === "" ? null : sql, run: true });
      setSql(result.sql);
      setRanSql(result.sql);
      if (result.run !== null) {
        setRun(result.run);
        setView({ kind: "results" });
      }
      setAsk({ prompt: "", busy: false, result, error: null });
    } catch (cause) {
      setAsk((current) => ({ ...current, busy: false, result: null, error: errorMessage(cause) }));
    }
  };

  const preview = (table: TableInfo) => {
    const text = `SELECT *\nFROM ${qualifiedName(table.schema, table.name)}\nLIMIT 100;`;
    setSql(text);
    void execute(text);
  };

  const resizeEditor = (event: ReactPointerEvent<HTMLDivElement>) => {
    const available = column.current?.clientHeight ?? 800;
    let next = editorHeight;
    drag(
      event,
      (_dx, dy) => {
        next = Math.min(Math.max(MIN_EDITOR, editorHeight + dy), Math.max(MIN_EDITOR, available - MIN_RESULTS));
        setEditorHeight(next);
      },
      () => writeStored(EDITOR_HEIGHT_KEY, String(next)),
    );
  };

  const resizeSchema = (event: ReactPointerEvent<HTMLDivElement>) => {
    let next = schemaWidth;
    drag(
      event,
      (dx) => {
        next = Math.min(Math.max(MIN_SCHEMA, schemaWidth + dx), MAX_SCHEMA);
        setSchemaWidth(next);
      },
      () => writeStored(SCHEMA_WIDTH_KEY, String(next)),
    );
  };

  const toggleSchema = () => {
    setSchemaPinned(!schemaOpen);
    writeStored(SCHEMA_OPEN_KEY, schemaOpen ? "0" : "1");
  };

  const busy = runningId !== null;
  const claudeMissing = status !== null && !status.claude.available;

  return (
    <div ref={rootRef} className="flex h-full min-h-0">
      <aside style={{ width: schemaWidth }} className={cn("relative max-w-[50%] shrink-0 border-r border-border", !schemaOpen && "hidden")}>
        <SchemaBrowser
          snapshot={schema.snapshot}
          loading={schema.loading}
          error={schema.error}
          onRefresh={() => schema.refresh(true)}
          onPreview={preview}
          onDescribe={(table) => setView({ kind: "table", table })}
          onInsert={(text) => editor.current?.insert(text)}
        />
        <div role="separator" aria-orientation="vertical" aria-label="Resize schema" onPointerDown={resizeSchema} className="absolute inset-y-0 -right-0.5 z-10 w-1 cursor-col-resize hover:bg-ring" />
      </aside>
      <div ref={column} className="flex min-w-0 flex-1 flex-col">
        <form onSubmit={askNow} className="flex flex-col gap-1 border-b border-border px-3 py-2">
          <div className="flex items-center gap-2">
            <Icon name="AiContentGenerator01" className="size-4 shrink-0 text-violet-600 dark:text-violet-400" aria-hidden />
            <Input
              value={ask.prompt}
              onChange={(event) => setAsk((current) => ({ ...current, prompt: event.target.value }))}
              onKeyDown={(event) => (event.key === "Escape" && ask.prompt !== "" ? setAsk((current) => ({ ...current, prompt: "" })) : undefined)}
              placeholder={claudeMissing ? `claude CLI not found at “${status?.claude.path}”; set its path in the plugin settings` : "What do you want to see?"}
              title={claudeMissing ? undefined : "Describe the data in plain English, e.g. “active subscribers per plan, most popular first”"}
              aria-label="Describe the query in plain language"
              disabled={ask.busy || claudeMissing}
              className="h-8 min-w-0 text-sm"
            />
            <Button type="submit" size="sm" className="h-8 shrink-0" disabled={ask.busy || claudeMissing || ask.prompt.trim() === ""}>
              {ask.busy ? <Spinner /> : <Icon name="AiContentGenerator01" className="size-3.5" />}
              Ask
            </Button>
          </div>
          {ask.busy ? (
            <p role="status" className="pl-6 text-xs text-muted-foreground">
              Writing SQL for “{ask.prompt.trim()}”…
            </p>
          ) : null}
          {ask.result === null || ask.busy ? null : (
            <p className="pl-6 text-xs text-muted-foreground">
              {ask.result.explanation === "" ? "Generated SQL is in the editor." : ask.result.explanation}
              <span className="ml-2 opacity-70">
                {ask.result.model}
                {ask.result.costUsd === null ? "" : ` · $${ask.result.costUsd.toFixed(3)}`}
                {ask.result.attempts > 1 ? ` · fixed after ${ask.result.attempts} attempts` : ""}
              </span>
              {ask.result.readOnly ? null : <span className="ml-2 text-amber-600 dark:text-amber-400">This statement changes data, so it was not run. Review it, enable writes, and run it yourself.</span>}
            </p>
          )}
          {ask.error === null ? null : (
            <p role="alert" className="pl-6 text-xs text-destructive">
              {ask.error}
            </p>
          )}
        </form>
        <section style={{ height: editorHeight }} className="shrink-0">
          <Editor ref={editor} value={sql} onChange={setSql} snapshot={schema.snapshot} onRun={() => void execute()} onExplain={() => void explain(false)} />
        </section>
        <div role="separator" aria-orientation="horizontal" aria-label="Resize editor" onPointerDown={resizeEditor} className="h-1 shrink-0 cursor-row-resize bg-border hover:bg-ring" />
        <div className="@container/toolbar flex items-center gap-1 border-b border-border px-2 py-1">
          <IconButton label={schemaOpen ? "Hide schema" : "Show schema"} icon="PanelLeft" pressed={schemaOpen} onClick={toggleSchema} className="w-7 px-0" />
          <Hint label={busy ? "Cancel the query (Esc)" : "Run the selection or the whole editor (⌘↵)"}>
            <Button size="sm" className="h-7 shrink-0 gap-1.5 px-2.5 text-xs" onClick={() => (busy ? cancel() : void execute())} disabled={!busy && sql.trim() === ""}>
              <Icon name={busy ? "Square" : "Play"} className="size-3.5" />
              {busy ? "Cancel" : "Run"}
              <Kbd className="hidden @md/toolbar:inline">{busy ? "Esc" : "⌘↵"}</Kbd>
            </Button>
          </Hint>
          <IconButton label="Explain (⇧⌘↵)" icon="Workflow" onClick={() => void explain(false)} disabled={busy || explaining || sql.trim() === ""}>
            <ToolLabel>Explain</ToolLabel>
          </IconButton>
          <IconButton label="Explain analyze: runs the statement and shows real timings" icon="ChartColumn" onClick={() => void explain(true)} disabled={busy || explaining || sql.trim() === ""}>
            <ToolLabel>Analyze</ToolLabel>
          </IconButton>
          <span className="mx-1 h-4 w-px shrink-0 bg-border" />
          <IconButton label="Save query" icon="Star" onClick={() => setSaveOpen(true)} disabled={sql.trim() === ""}>
            <ToolLabel>Save</ToolLabel>
          </IconButton>
          <IconButton label="Open history" icon="Clock" onClick={() => appPanel.openFixedTab({ surface: { kind: "current" }, tab: HISTORY_TAB })} />
          <IconButton label="Open saved queries" icon="ListView" onClick={() => appPanel.openFixedTab({ surface: { kind: "current" }, tab: SAVED_TAB })} />
          <span className="flex-1" />
          {view.kind === "results" ? null : (
            <IconButton label="Back to results" icon="GridView" onClick={() => setView({ kind: "results" })}>
              <ToolLabel>Results</ToolLabel>
            </IconButton>
          )}
          <span className={cn("hidden min-w-0 truncate text-xs text-muted-foreground @2xl/toolbar:block", connection.allowWrites && "text-amber-600 dark:text-amber-400")} title={`${connection.host}:${connection.port}`}>
            {connection.name} · <span className="font-mono">{connection.database}</span> · {connection.allowWrites ? "writes on" : "read-only"}
          </span>
        </div>
        <section className="min-h-0 flex-1">
          {view.kind === "plan" ? (
            <PlanView result={view.plan} sql={view.sql} />
          ) : view.kind === "table" ? (
            <TableDetail table={view.table} onPreview={() => preview(view.table)} onClose={() => setView({ kind: "results" })} />
          ) : (
            <Results run={run} sql={ranSql} running={busy} connectionName={connection.name} onCancel={cancel} />
          )}
        </section>
      </div>
      <SaveQueryDialog open={saveOpen} sql={editor.current?.selectionOrAll() ?? sql} connectionId={connection.id} existing={null} onClose={() => setSaveOpen(false)} />
    </div>
  );
}

function NoConnections() {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md">
        <EmptyState className="py-10">
          <Icon name="database/database" className="mx-auto mb-3 size-8 text-muted-foreground" aria-hidden />
          <p className="text-base font-medium text-foreground">Connect to a Postgres database</p>
          <p className="mt-1">Add an RDS cluster with your AWS SSO profile, or any Postgres with a password. Then browse its schema, run SQL, or just describe what you want to see.</p>
          <Button className="mt-4" onClick={() => setOpen(true)}>
            <Icon name="Plus" className="size-4" />
            Add connection
          </Button>
        </EmptyState>
      </div>
      <ConnectionDialog open={open} connection={null} onClose={() => setOpen(false)} onSaved={() => undefined} />
    </div>
  );
}

export function DatabasePage(_props: PluginNavPanelProps) {
  const session = useSessionSync();
  const connection = activeConnection(session);
  if (!session.loaded) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground" role="status">
        <Spinner className="mr-2" /> Loading connections…
      </div>
    );
  }
  if (session.error !== null && session.connections.length === 0) {
    return (
      <p role="alert" className="m-4 text-sm text-destructive">
        {session.error}
      </p>
    );
  }
  if (connection === null) return <NoConnections />;
  return <Workbench key={connection.id} connection={connection} />;
}
