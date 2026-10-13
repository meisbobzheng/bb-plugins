import { useState, type KeyboardEvent } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { LIBRARY_PANEL } from "../library";
import { EntryFields, draftFromText, isDraftValid, type Draft } from "./EntryFields";
import { errorMessage, useLibraryRpc } from "./hooks";
import type { SaveRequest } from "./requests";

export function SaveDialog({ request, onClose }: { request: SaveRequest; onClose: () => void }) {
  const rpc = useLibraryRpc();
  const navigate = useBbNavigate();
  const [draft, setDraft] = useState<Draft>(() => draftFromText(request.text));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSave = isDraftValid(draft) && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const entry = await rpc.call("save", { ...draft, threadId: request.threadId, messageId: request.messageId });
      toast.success(`Saved “${entry.title}” to Library`, {
        action: { label: "Open", onClick: () => navigate.toPluginPanel(LIBRARY_PANEL, { subPath: entry.id }) },
      });
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
      setSaving(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    void save();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-2xl" onKeyDown={onKeyDown}>
        <DialogHeader>
          <DialogTitle>Save to Library</DialogTitle>
          <DialogDescription>Search it later from the Library page, or ask any agent to find it.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <EntryFields draft={draft} onChange={setDraft} initialBodyMode="preview" autoFocusTitle bodyClassName="max-h-72 min-h-32" />
          {error === null ? null : (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
