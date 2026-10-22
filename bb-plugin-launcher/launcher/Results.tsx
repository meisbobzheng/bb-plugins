import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from "react";
import { toast } from "sonner";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { cn } from "@/lib/utils";
import { useLauncher } from "./context";
import { errorMessage } from "./data";
import { MOD_ENTER, MOD_K, hasMod, matchesShortcut, shortcutLabel } from "./keys";
import { matchRanges, queryTerms } from "./match";
import { PreviewPane } from "./Preview";
import type { Action, Item, Section } from "./types";

export type KeyHandler = (event: KeyboardEvent<HTMLInputElement>) => boolean;

export interface ResultsHost {
  keyHandler: MutableRefObject<KeyHandler | null>;
  input: RefObject<HTMLInputElement | null>;
  listboxId: string;
  restoreSelection(): string | null;
  saveSelection(id: string): void;
}

export const ResultsHostContext = createContext<ResultsHost | null>(null);

function useResultsHost(): ResultsHost {
  const host = useContext(ResultsHostContext);
  if (host === null) throw new Error("Results must be used inside the launcher");
  return host;
}

export interface ResultsProps {
  sections: readonly Section[];
  query: string;
  emptyText?: string;
  showPreview: boolean;
  highlight?: boolean;
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1.5 py-px font-sans text-[11px] text-muted-foreground">
      {children}
    </kbd>
  );
}

function Highlighted({ text, terms }: { text: string; terms: readonly string[] }) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const [start, end] of matchRanges(terms, text)) {
    parts.push(
      text.slice(cursor, start),
      <mark key={start} className="bg-transparent font-semibold text-foreground">
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  }
  parts.push(text.slice(cursor));
  return <>{parts}</>;
}

export function useRunAction() {
  const ctx = useLauncher();
  return useCallback(
    (item: Item, action: Action) => {
      if (item.usageKey !== undefined) ctx.recordUse(item.usageKey);
      if (!action.keepOpen) ctx.controls.close();
      Promise.resolve()
        .then(() => action.run())
        .catch((cause: unknown) => toast.error(`${action.title} failed`, { description: errorMessage(cause) }));
    },
    [ctx],
  );
}

interface RowProps {
  id: string;
  item: Item;
  index: number;
  active: boolean;
  terms: readonly string[];
  onSelect(id: string): void;
  onRun(item: Item, action: Action): void;
}

const Row = memo(function Row({ id, item, index, active, terms, onSelect, onRun }: RowProps) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      data-index={index}
      onMouseMove={() => !active && onSelect(item.id)}
      onClick={() => item.actions[0] && onRun(item, item.actions[0])}
      className={cn(
        "flex h-9 cursor-default items-center gap-3 rounded-md px-3 text-sm",
        active && "bg-state-active",
      )}
    >
      <span className="flex size-5 shrink-0 items-center justify-center">{item.icon}</span>
      <span className="min-w-0 flex-1 truncate">
        <span className="text-foreground">
          {typeof item.title === "string" ? <Highlighted text={item.title} terms={terms} /> : item.title}
        </span>
        {item.subtitle ? (
          <span className="ml-2 text-xs text-muted-foreground">{item.subtitle}</span>
        ) : null}
      </span>
      {item.accessory ? <span className="shrink-0">{item.accessory}</span> : null}
    </div>
  );
});

export function Results({ sections, query, emptyText = "No results", showPreview, highlight = true }: ResultsProps) {
  const ctx = useLauncher();
  const runAction = useRunAction();
  const host = useResultsHost();
  const compact = useIsCompactViewport();
  const items = useMemo(() => sections.flatMap((section) => section.items), [sections]);
  const previewable = useMemo(() => items.some((item) => item.preview !== undefined), [items]);
  const terms = useMemo(() => (highlight ? queryTerms(query) : []), [highlight, query]);
  const [selection, setSelection] = useState(() => ({ query, id: host.restoreSelection() }));
  const listRef = useRef<HTMLDivElement>(null);

  if (selection.query !== query) setSelection({ query, id: null });
  const index = Math.max(0, items.findIndex((item) => item.id === selection.id));
  const selected = items[index];
  const optionId = (position: number) => `${host.listboxId}-${position}`;
  const select = useCallback((id: string) => setSelection({ query, id }), [query]);

  useEffect(() => {
    if (selected !== undefined) host.saveSelection(selected.id);
  }, [host, selected?.id]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list === null) return;
    if (index === 0) list.scrollTop = 0;
    else list.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index, query]);

  useLayoutEffect(() => {
    const input = host.input.current;
    if (selected === undefined) input?.removeAttribute("aria-activedescendant");
    else input?.setAttribute("aria-activedescendant", optionId(index));
  });

  const move = (delta: number) => {
    if (items.length === 0) return;
    select(items[(index + delta + items.length) % items.length]!.id);
  };

  const openActions = (item: Item) =>
    ctx.controls.push({ kind: "actions", item });

  const actionFor = (event: KeyboardEvent<HTMLInputElement>): Action | undefined => {
    if (selected === undefined) return undefined;
    if (event.key === "Enter" && !event.shiftKey && !event.altKey) {
      return hasMod(event) ? selected.actions[1] : selected.actions[0];
    }
    return selected.actions.find(
      (action) => action.shortcut !== undefined && matchesShortcut(event, action.shortcut),
    );
  };

  const handleKey: KeyHandler = (event) => {
    const ctrlOnly = event.ctrlKey && !event.metaKey;
    if (event.key === "ArrowDown" || (ctrlOnly && event.key === "n")) {
      move(1);
      return true;
    }
    if (event.key === "ArrowUp" || (ctrlOnly && event.key === "p")) {
      move(-1);
      return true;
    }
    if (selected === undefined) return false;
    if (matchesShortcut(event, MOD_K)) {
      openActions(selected);
      return true;
    }
    const action = actionFor(event);
    if (action !== undefined) runAction(selected, action);
    return action !== undefined || event.key === "Enter";
  };

  useLayoutEffect(() => {
    host.keyHandler.current = handleKey;
  });

  let position = 0;
  const primary = selected?.actions[0];
  const secondary = selected?.actions[1];

  return (
    <>
      <div className="flex min-h-0 flex-1">
        <div
          ref={listRef}
          id={host.listboxId}
          role="listbox"
          aria-label="Results"
          onMouseDown={(event) => event.preventDefault()}
          className="min-h-0 flex-1 overflow-y-auto p-2"
        >
          {items.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">{emptyText}</p>
          ) : (
            sections.map((section) =>
              section.items.length === 0 ? null : (
                <div key={section.title} role="group" aria-label={section.title} className="mb-1">
                  <div className="px-3 pb-1 pt-2 text-[11px] font-medium text-muted-foreground">
                    {section.title}
                  </div>
                  {section.items.map((item) => {
                    const itemIndex = position++;
                    return (
                      <Row
                        key={item.id}
                        id={optionId(itemIndex)}
                        item={item}
                        index={itemIndex}
                        active={itemIndex === index}
                        terms={terms}
                        onSelect={select}
                        onRun={runAction}
                      />
                    );
                  })}
                </div>
              ),
            )
          )}
        </div>
        {showPreview && !compact && previewable && selected !== undefined ? (
          <aside aria-label="Preview" className="hidden w-[42%] shrink-0 overflow-y-auto border-l border-border md:block">
            <PreviewPane item={selected} />
          </aside>
        ) : null}
      </div>
      <div
        onMouseDown={(event) => event.preventDefault()}
        className="flex h-10 shrink-0 items-center justify-end gap-4 border-t border-border px-3 text-xs text-muted-foreground"
      >
        {primary !== undefined ? (
          <button
            type="button"
            className="flex items-center gap-1.5 hover:text-foreground"
            onClick={() => selected && runAction(selected, primary)}
          >
            {primary.title} <Kbd>↵</Kbd>
          </button>
        ) : null}
        {secondary !== undefined ? (
          <button
            type="button"
            className="hidden items-center gap-1.5 hover:text-foreground sm:flex"
            onClick={() => selected && runAction(selected, secondary)}
          >
            {secondary.title} <Kbd>{shortcutLabel(MOD_ENTER)}</Kbd>
          </button>
        ) : null}
        {selected !== undefined && selected.actions.length > 1 ? (
          <button
            type="button"
            className="flex items-center gap-1.5 hover:text-foreground"
            onClick={() => openActions(selected)}
          >
            Actions <Kbd>{shortcutLabel(MOD_K)}</Kbd>
          </button>
        ) : null}
      </div>
    </>
  );
}
