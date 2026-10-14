import { useState, type KeyboardEvent } from "react";
import { Markdown, UrlLink, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Icon } from "./ui/icon";
import type { Entry } from "../contract";
import { specUrl, specsFor } from "../glossary";
import { EmptyState, GroupedTags, KindBadge, TagChip, formatDate } from "./bits";
import { EntryFields, isDraftValid, type Draft } from "./EntryFields";
import { errorMessage, useEntry, useLibraryRpc } from "./hooks";

export function entryReference(entry: Pick<Entry, "id" | "title">): string {
  return `Library entry ${entry.id} “${entry.title}” (read it with \`bb library show ${entry.id}\`)`;
}

interface EntryViewProps {
  id: string;
  onBack?: () => void;
  onDeleted: () => void;
  onTagClick?: (tag: string) => void;
  onInsert?: (entry: Entry) => void;
}

export function EntryView({ id, onBack, onDeleted, onTagClick, onInsert }: EntryViewProps) {
  const { entry, error } = useEntry(id);
  const [editing, setEditing] = useState(false);
  const back =
    onBack === undefined ? null : (
      <Button variant="ghost" size="sm" className="-ml-2 mb-2 text-muted-foreground" onClick={onBack}>
        <Icon name="ArrowLeft" />
        Library
      </Button>
    );

  let content;
  if (entry === undefined) {
    content =
      error === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      );
  } else if (entry === null) {
    content = <EmptyState>This entry no longer exists.</EmptyState>;
  } else if (editing) {
    content = <EntryEditor entry={entry} onDone={() => setEditing(false)} />;
  } else {
    content = <EntryReader entry={entry} onEdit={() => setEditing(true)} onDeleted={onDeleted} onTagClick={onTagClick} onInsert={onInsert} />;
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-8 pt-3 md:px-6 md:pt-4">
      {back}
      {content}
    </div>
  );
}

interface EntryReaderProps {
  entry: Entry;
  onEdit: () => void;
  onDeleted: () => void;
  onTagClick?: (tag: string) => void;
  onInsert?: (entry: Entry) => void;
}

function EntryReader({ entry, onEdit, onDeleted, onTagClick, onInsert }: EntryReaderProps) {
  const navigate = useBbNavigate();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const specs = specsFor(entry.tags.map(({ tag }) => tag), entry.body);
  const { threadId, threadTitle } = entry.source;

  const copy = () => {
    navigator.clipboard.writeText(entry.body).then(
      () => toast.success("Copied Markdown"),
      () => toast.error("Could not copy to the clipboard"),
    );
  };

  return (
    <article>
      <header className="space-y-3">
        <h1 className="text-xl font-semibold leading-tight text-foreground">{entry.title}</h1>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <KindBadge kind={entry.kind} />
          <span title={new Date(entry.createdAt).toLocaleString()}>Saved {formatDate(entry.createdAt)}</span>
          {threadId !== null ? (
            <button type="button" className="cursor-pointer truncate underline-offset-2 hover:text-foreground hover:underline" onClick={() => navigate.toThread(threadId)}>
              from “{threadTitle ?? "conversation"}”
            </button>
          ) : threadTitle !== null ? (
            <span className="truncate">from “{threadTitle}” (deleted)</span>
          ) : null}
        </div>
        {entry.summary === "" ? null : <p className="text-sm text-muted-foreground">{entry.summary}</p>}
        {entry.tags.length === 0 ? null : (
          <GroupedTags
            tags={entry.tags}
            chip={({ tag, group }) => (
              <TagChip key={tag} tag={tag} group={group} onClick={onTagClick === undefined ? undefined : () => onTagClick(tag)} />
            )}
          />
        )}
        {specs.length === 0 ? null : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="text-muted-foreground">Specs</span>
            {specs.map((spec) => {
              const url = specUrl(spec);
              return url === null ? (
                <span key={spec}>{spec}</span>
              ) : (
                <UrlLink key={spec} href={url} className="text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground">
                  {spec}
                </UrlLink>
              );
            })}
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          {onInsert === undefined ? null : (
            <Button size="sm" onClick={() => onInsert(entry)}>
              <Icon name="CornerDownLeft" />
              Insert in message
            </Button>
          )}
          {threadId === null ? null : (
            <Button size="sm" variant="outline" onClick={() => navigate.toThread(threadId)}>
              <Icon name="MessageSquare" />
              Conversation
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate.toCompose({ initialPrompt: `Using ${entryReference(entry)}: `, focusPrompt: true })}
          >
            <Icon name="MessageSquarePlus" />
            Ask in new thread
          </Button>
          <Button size="sm" variant="ghost" onClick={copy}>
            <Icon name="Copy" />
            Copy
          </Button>
          <Button size="sm" variant="ghost" onClick={onEdit}>
            <Icon name="Edit" />
            Edit
          </Button>
          <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => setConfirmingDelete(true)}>
            <Icon name="Trash2" />
            Delete
          </Button>
        </div>
      </header>
      <div className="mt-4 border-t border-border pt-4">
        <Markdown content={entry.body} />
      </div>
      {confirmingDelete ? <DeleteDialog entry={entry} onClose={() => setConfirmingDelete(false)} onDeleted={onDeleted} /> : null}
    </article>
  );
}

function EntryEditor({ entry, onDone }: { entry: Entry; onDone: () => void }) {
  const rpc = useLibraryRpc();
  const [draft, setDraft] = useState<Draft>({ title: entry.title, kind: entry.kind, summary: entry.summary, body: entry.body, tags: entry.tags });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSave = isDraftValid(draft) && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await rpc.call("update", { id: entry.id, ...draft });
      toast.success("Saved changes");
      onDone();
    } catch (cause) {
      setError(errorMessage(cause));
      setSaving(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") onDone();
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    void save();
  };

  return (
    <form
      className="grid gap-4"
      onKeyDown={onKeyDown}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <EntryFields draft={draft} onChange={setDraft} initialBodyMode="markdown" bodyClassName="min-h-[24rem]" />
      {error === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSave}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

function DeleteDialog({ entry, onClose, onDeleted }: { entry: Entry; onClose: () => void; onDeleted: () => void }) {
  const rpc = useLibraryRpc();
  const [deleting, setDeleting] = useState(false);
  const remove = async () => {
    setDeleting(true);
    try {
      await rpc.call("remove", { id: entry.id });
      toast.success(`Deleted “${entry.title}”`);
      onClose();
      onDeleted();
    } catch (cause) {
      toast.error(errorMessage(cause));
      setDeleting(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this entry?</DialogTitle>
          <DialogDescription>“{entry.title}” will be removed from your Library. This can’t be undone.</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={deleting} onClick={() => void remove()}>
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
