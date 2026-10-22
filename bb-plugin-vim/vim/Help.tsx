import * as Dialog from "@radix-ui/react-dialog";
import { usePortalScopeProps } from "@/lib/portal-scope";
import { COMMANDS, sequencesFor, type Group } from "./bindings";
import { IS_MAC, formatKeys } from "./keys";
import { vim } from "./store";

const GROUPS: readonly Group[] = ["Move", "Act", "Go"];

export function Help({ open }: { open: boolean }) {
  const scopeProps = usePortalScopeProps();
  return (
    <Dialog.Root open={open} onOpenChange={(next) => vim.set({ help: next })}>
      <Dialog.Portal>
        <Dialog.Overlay {...scopeProps} className="fixed inset-0 z-50 bg-black/30" />
        <Dialog.Content
          {...scopeProps}
          aria-describedby={undefined}
          className="fixed left-1/2 top-[10vh] z-50 flex max-h-[80vh] w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl outline-none"
        >
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
            <Dialog.Title className="text-sm font-semibold">Vim keys</Dialog.Title>
            <span className="text-xs text-muted-foreground">Esc or ? to close</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {GROUPS.map((group) => (
              <section key={group} aria-label={group} className="mb-3 last:mb-0">
                <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{group}</h3>
                <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-1 text-sm">
                  {COMMANDS.filter((command) => command.group === group).map((command) => (
                    <div key={command.action} className="contents">
                      <dt className="flex flex-wrap gap-1">
                        {sequencesFor(command, IS_MAC).map((sequence) => (
                          <kbd key={sequence} className="rounded border border-border bg-muted px-1.5 font-mono text-xs leading-5 text-foreground">
                            {formatKeys(sequence)}
                          </kbd>
                        ))}
                      </dt>
                      <dd className="leading-6 text-muted-foreground">{command.label}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
            <p className="mt-3 text-xs text-muted-foreground">
              Keys work whenever you are not typing. Lists like the sidebar, the Library, and PR Board columns move a cursor;
              everything else scrolls. While hints show, Backspace undoes a letter and Esc cancels.
            </p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
