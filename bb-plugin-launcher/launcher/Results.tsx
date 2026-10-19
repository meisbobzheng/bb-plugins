import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MutableRefObject,
} from "react";
import { toast } from "sonner";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { cn } from "@/lib/utils";
import { useLauncher } from "./context";
import { errorMessage } from "./data";
import { MOD_K, hasMod, matchesShortcut, shortcutLabel } from "./keys";
import { PreviewPane } from "./Preview";
import type { Action, Item, Section } from "./types";

export type KeyHandler = (event: KeyboardEvent<HTMLInputElement>) => boolean;

export const KeyHandlerContext = createContext<MutableRefObject<KeyHandler | null> | null>(null);

export interface ResultsProps {
  sections: readonly Section[];
  query: string;
  emptyText?: string;
  showPreview: boolean;
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1.5 py-px font-sans text-[11px] text-muted-foreground">
      {children}
    </kbd>
  );
}

export function useRunAction() {
  const ctx = useLauncher();
  return (item: Item, action: Action) => {
    if (item.usageKey !== undefined) ctx.recordUse(item.usageKey);
    if (!action.keepOpen) ctx.controls.close();
    Promise.resolve()
      .then(() => action.run())
      .catch((cause: unknown) => toast.error(`${action.title} failed`, { description: errorMessage(cause) }));
  };
}

export function Results({ sections, query, emptyText = "No results", showPreview }: ResultsProps) {
  const ctx = useLauncher();
  const runAction = useRunAction();
  const keyHandler = useContext(KeyHandlerContext);
  const compact = useIsCompactViewport();
  const items = useMemo(() => sections.flatMap((section) => section.items), [sections]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const index = Math.max(0, items.findIndex((item) => item.id === selectedId));
  const selected = items[index];

  useEffect(() => setSelectedId(null), [query]);

  useLayoutEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${index}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const move = (delta: number) => {
    if (items.length === 0) return;
    setSelectedId(items[(index + delta + items.length) % items.length]!.id);
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
    if (keyHandler !== null) keyHandler.current = handleKey;
  });

  let position = 0;
  const primary = selected?.actions[0];

  return (
    <>
      <div className="flex min-h-0 flex-1">
        <div ref={listRef} role="listbox" className="min-h-0 flex-1 overflow-y-auto p-2">
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
                    const active = itemIndex === index;
                    return (
                      <div
                        key={item.id}
                        role="option"
                        aria-selected={active}
                        data-index={itemIndex}
                        onMouseMove={() => !active && setSelectedId(item.id)}
                        onClick={() => item.actions[0] && runAction(item, item.actions[0])}
                        className={cn(
                          "flex h-9 cursor-default items-center gap-3 rounded-md px-3 text-sm",
                          active && "bg-state-active",
                        )}
                      >
                        <span className="flex size-5 shrink-0 items-center justify-center">{item.icon}</span>
                        <span className="min-w-0 flex-1 truncate">
                          <span className="text-foreground">{item.title}</span>
                          {item.subtitle ? (
                            <span className="ml-2 text-xs text-muted-foreground">{item.subtitle}</span>
                          ) : null}
                        </span>
                        {item.accessory ? <span className="shrink-0">{item.accessory}</span> : null}
                      </div>
                    );
                  })}
                </div>
              ),
            )
          )}
        </div>
        {showPreview && !compact && selected?.preview !== undefined ? (
          <div className="hidden w-[42%] shrink-0 overflow-y-auto border-l border-border md:block">
            <PreviewPane preview={selected.preview} />
          </div>
        ) : null}
      </div>
      <div className="flex h-10 shrink-0 items-center justify-end gap-4 border-t border-border px-3 text-xs text-muted-foreground">
        {primary !== undefined ? (
          <button
            type="button"
            className="flex items-center gap-1.5 hover:text-foreground"
            onClick={() => selected && runAction(selected, primary)}
          >
            {primary.title} <Kbd>↵</Kbd>
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
