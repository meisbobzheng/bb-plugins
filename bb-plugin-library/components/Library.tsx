import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import {
  experimental_usePluginId,
  useBbNavigate,
  useComposer,
  type PluginNavPanelProps,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { useIsCompactViewport } from "./ui/hooks/use-compact-viewport";
import { Icon } from "./ui/icon";
import { Input } from "./ui/input";
import { cn } from "../lib/utils";
import type { Entry, EntryHit, SearchResult } from "../contract";
import { KINDS, KIND_LABELS, LIBRARY_PANEL, LIMITS, type Kind } from "../library";
import { normalizeTagNames } from "../glossary";
import { EmptyState, ErrorState, Highlighted, KindBadge, TagChip, formatDate } from "./bits";
import { EntryView, entryReference } from "./EntryView";
import { useLibrarySearch } from "./hooks";
import {
  EMPTY_FILTERS,
  lastEntry,
  lastFilters,
  markLibraryVisible,
  rememberEntry,
  rememberFilters,
  useScrollMemory,
  type Filters,
} from "./session";
import { TagMenus } from "./TagMenus";

const RESULT_LIMIT = 100;

export function idFromSubPath(subPath: string): string | null {
  const first = subPath.split("/")[0] ?? "";
  return /^lib_[a-z0-9]{8}$/.test(first) ? first : null;
}

function withTag(filters: Filters, tag: string): Filters {
  return { ...filters, tags: normalizeTagNames([...filters.tags, tag]).slice(0, LIMITS.tagFilters) };
}

function useSlashFocus(target: RefObject<HTMLInputElement | null>, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const element = event.target instanceof HTMLElement ? event.target : null;
      if (element?.closest("input, textarea, select, [contenteditable]") != null) return;
      event.preventDefault();
      target.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [target, enabled]);
}

interface BrowserProps {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  threadId: string | null;
  focusShortcut?: boolean;
}

export function LibraryBrowser({ filters, onFiltersChange, selectedId, onSelect, threadId, focusShortcut = false }: BrowserProps) {
  const { result, error, retry } = useLibrarySearch({
    query: filters.query,
    kind: filters.kind,
    tags: filters.tags,
    threadId: filters.thisThread ? threadId : null,
    limit: RESULT_LIMIT,
  });
  const searchRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(-1);
  useSlashFocus(searchRef, focusShortcut);
  useEffect(() => setActive(-1), [result]);

  const entries = result?.entries ?? [];
  const set = (patch: Partial<Filters>) => onFiltersChange({ ...filters, ...patch });
  const hasFilters = filters.query.trim() !== "" || filters.kind !== null || filters.tags.length > 0 || filters.thisThread;

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => Math.max(0, Math.min(entries.length - 1, current + step)));
    } else if (event.key === "Enter") {
      const hit = entries[Math.max(active, 0)];
      if (hit !== undefined) onSelect(hit.id);
    } else if (event.key === "Escape" && filters.query !== "") {
      event.stopPropagation();
      set({ query: "" });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2.5 border-b border-border p-3">
        <div className="relative">
          <Icon name="Search" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            type="search"
            value={filters.query}
            maxLength={LIMITS.query}
            placeholder={focusShortcut ? "Search flows, diagrams, docs…  ( / )" : "Search flows, diagrams, docs…"}
            aria-label="Search the Library"
            aria-controls="library-results"
            className="pl-8"
            onChange={(event) => set({ query: event.target.value })}
            onKeyDown={onSearchKeyDown}
          />
        </div>
        <KindFilter result={result} value={filters.kind} onChange={(kind) => set({ kind })} />
        <TagFilter result={result} selected={filters.tags} onChange={(tags) => set({ tags })} />
        {threadId === null ? null : (
          <TagChip tag="Saved from this thread" active={filters.thisThread} onClick={() => set({ thisThread: !filters.thisThread })} />
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error !== null ? (
          <div className="p-3">
            <ErrorState message="Could not search the Library." error={error} onRetry={retry} />
          </div>
        ) : result === null ? (
          <p className="p-3 text-sm text-muted-foreground">Loading…</p>
        ) : result.total === 0 ? (
          <div className="p-3">
            {hasFilters ? (
              <EmptyState>
                No entries match.{" "}
                <button type="button" className="cursor-pointer underline underline-offset-2" onClick={() => onFiltersChange(EMPTY_FILTERS)}>
                  Clear filters
                </button>
              </EmptyState>
            ) : (
              <EmptyState>
                Nothing saved yet. Use <strong className="text-foreground">Save to Library</strong> on any chat message, or ask an agent to
                “save this flow to my Library”.
              </EmptyState>
            )}
          </div>
        ) : (
          <>
            <p className="px-3 pb-1 pt-2 text-xs text-muted-foreground" aria-live="polite">
              {result.total === 1 ? "1 entry" : `${result.total} entries`}
              {result.total > entries.length ? ` · showing ${entries.length}` : ""}
            </p>
            <ul id="library-results" className="pb-2">
              {entries.map((hit, index) => (
                <ResultRow key={hit.id} hit={hit} selected={hit.id === selectedId} active={index === active} onSelect={() => onSelect(hit.id)} />
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function KindFilter({ result, value, onChange }: { result: SearchResult | null; value: Kind | null; onChange: (kind: Kind | null) => void }) {
  const counts = new Map(result?.kinds.map(({ kind, count }) => [kind, count]));
  const all = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const options = KINDS.filter((kind) => counts.has(kind) || kind === value);
  if (options.length === 0) return null;
  const pill = (selected: boolean) =>
    cn(
      "h-7 cursor-pointer rounded-md px-2 text-xs transition-colors",
      selected ? "bg-state-active font-medium text-foreground" : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
    );
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by kind">
      <button type="button" aria-pressed={value === null} className={pill(value === null)} onClick={() => onChange(null)}>
        All <span className="tabular-nums opacity-70">{all}</span>
      </button>
      {options.map((kind) => (
        <button key={kind} type="button" aria-pressed={value === kind} className={pill(value === kind)} onClick={() => onChange(value === kind ? null : kind)}>
          {KIND_LABELS[kind].many} <span className="tabular-nums opacity-70">{counts.get(kind) ?? 0}</span>
        </button>
      ))}
    </div>
  );
}

function TagFilter({ result, selected, onChange }: { result: SearchResult | null; selected: string[]; onChange: (tags: string[]) => void }) {
  const chosen = new Set(selected.map((tag) => tag.toLowerCase()));
  const facets = (result?.total ?? 0) > 1 || selected.length > 0 ? (result?.tags ?? []) : [];
  if (selected.length === 0 && facets.length === 0) return null;
  const remove = (tag: string) => onChange(selected.filter((candidate) => candidate.toLowerCase() !== tag.toLowerCase()));
  const toggle = (tag: string) => (chosen.has(tag.toLowerCase()) ? remove(tag) : onChange(normalizeTagNames([...selected, tag]).slice(0, LIMITS.tagFilters)));
  return (
    <div className="space-y-2">
      {selected.length === 0 ? null : (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Selected tags">
          {selected.map((tag) => (
            <TagChip key={tag} tag={tag} active onRemove={() => remove(tag)} />
          ))}
        </div>
      )}
      <TagMenus tags={facets} label="Filter by tag" selected={chosen} onToggle={toggle} />
    </div>
  );
}

function ResultRow({ hit, selected, active, onSelect }: { hit: EntryHit; selected: boolean; active: boolean; onSelect: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, []);
  const details = [...hit.tags.slice(0, 4).map(({ tag }) => tag), hit.source.threadTitle, formatDate(hit.updatedAt)]
    .filter((part) => part !== null && part !== "")
    .join(" · ");
  return (
    <li>
      <button
        ref={ref}
        type="button"
        data-vim-item=""
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
        className={cn(
          "block w-full cursor-pointer px-3 py-2.5 text-left transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
          selected && "bg-state-active hover:bg-state-active",
          active && "ring-1 ring-inset ring-ring",
        )}
      >
        <div className="flex items-start gap-2">
          <span title={hit.title} className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            {hit.title}
          </span>
          <KindBadge kind={hit.kind} />
        </div>
        {hit.snippet === "" ? null : (
          <p className="mt-0.5 line-clamp-2 break-words text-xs text-muted-foreground">
            <Highlighted text={hit.snippet} />
          </p>
        )}
        <p title={details} className="mt-1 truncate text-[11px] text-muted-foreground">
          {details}
        </p>
      </button>
    </li>
  );
}

function Placeholder() {
  return (
    <div className="mx-auto flex h-full max-w-md flex-col justify-center gap-3 p-6 text-sm text-muted-foreground">
      <p className="text-base font-medium text-foreground">Pick an entry to read it</p>
      <ul className="list-disc space-y-1.5 pl-5">
        <li>
          Press <kbd className="rounded border border-border px-1 font-mono text-xs">/</kbd> to search. Prefixes match, so “regis” finds registration
          flows.
        </li>
        <li>
          Save any chat message with <strong className="text-foreground">Save to Library</strong> in its action bar, or select text first to save
          just that part.
        </li>
        <li>Ask an agent to “save this call flow to my Library”, or to look up something you saved before.</li>
        <li>Tags like S6a, Gx, N8, Attach, and ULR/ULA are added automatically. Hover one to see its interface and spec.</li>
      </ul>
    </div>
  );
}

export function LibraryPage({ subPath }: PluginNavPanelProps) {
  const navigate = useBbNavigate();
  const pluginId = experimental_usePluginId();
  const compact = useIsCompactViewport();
  const scroller = useRef<HTMLElement>(null);
  const [filters, setFilters] = useState(() => lastFilters(pluginId));
  const [readyId, setReadyId] = useState<string | null>(null);
  const routedId = idFromSubPath(subPath);
  const restoredId = routedId === null && subPath === "" ? lastEntry(pluginId) : null;
  const shownId = routedId ?? restoredId;

  const select = (id: string | null) => {
    rememberEntry(pluginId, id);
    navigate.toPluginPanel(LIBRARY_PANEL, { subPath: id ?? "", replace: true });
  };

  useEffect(() => markLibraryVisible(), []);
  useEffect(() => rememberFilters(pluginId, filters), [pluginId, filters]);
  useEffect(() => {
    if (routedId !== null) rememberEntry(pluginId, routedId);
    else if (restoredId !== null) navigate.toPluginPanel(LIBRARY_PANEL, { subPath: restoredId, replace: true });
  }, [pluginId, routedId, restoredId, navigate]);
  useScrollMemory(scroller, shownId, readyId === shownId);

  const browser = (
    <LibraryBrowser filters={filters} onFiltersChange={setFilters} selectedId={shownId} onSelect={select} threadId={null} focusShortcut />
  );
  const entry =
    shownId === null ? null : (
      <EntryView
        key={shownId}
        id={shownId}
        onBack={compact ? () => select(null) : undefined}
        onDeleted={() => select(null)}
        onMissing={() => select(null)}
        onReady={() => setReadyId(shownId)}
        onTagClick={(tag) => {
          setFilters(withTag(filters, tag));
          if (compact) select(null);
        }}
      />
    );

  if (compact) {
    return (
      <main ref={scroller} className="h-full min-h-0 overflow-y-auto">
        {entry ?? browser}
      </main>
    );
  }
  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-80 shrink-0 flex-col border-r border-border xl:w-96">{browser}</aside>
      <main ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        {entry ?? <Placeholder />}
      </main>
    </div>
  );
}

export function ThreadLibraryPanel({ threadId }: PluginThreadPanelProps) {
  const composer = useComposer();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const insert = (entry: Entry) => {
    composer.insert(entryReference(entry), { at: "end", block: true });
    composer.focus();
    toast.success("Added to your message");
  };

  if (selectedId === null) {
    return <LibraryBrowser filters={filters} onFiltersChange={setFilters} selectedId={null} onSelect={setSelectedId} threadId={threadId} />;
  }
  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <EntryView
        key={selectedId}
        id={selectedId}
        onBack={() => setSelectedId(null)}
        onDeleted={() => setSelectedId(null)}
        onTagClick={(tag) => {
          setFilters(withTag(filters, tag));
          setSelectedId(null);
        }}
        onInsert={insert}
      />
    </div>
  );
}
