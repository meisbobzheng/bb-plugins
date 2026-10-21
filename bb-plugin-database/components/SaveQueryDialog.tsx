import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import type { SavedQuery } from "../contract";
import { Spinner } from "./bits";
import { errorMessage, useDbRpc } from "./hooks";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";

export function suggestName(sql: string): string {
  const line = sql
    .split("\n")
    .map((part) => part.trim())
    .find((part) => part !== "" && !part.startsWith("--"));
  return (line ?? "Query").replace(/\s+/g, " ").slice(0, 60);
}

export function SaveQueryDialog({
  open,
  sql,
  connectionId,
  existing,
  onClose,
  onSaved,
}: {
  open: boolean;
  sql: string;
  connectionId: string;
  existing: SavedQuery | null;
  onClose(): void;
  onSaved?(saved: SavedQuery): void;
}) {
  const rpc = useDbRpc();
  const [name, setName] = useState("");
  const [scoped, setScoped] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(existing?.name ?? suggestName(sql));
    setScoped(existing === null ? true : existing.connectionId !== null);
    setError(null);
  }, [open, sql, existing]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() === "") return setError("Give the query a name.");
    setSaving(true);
    try {
      const saved = await rpc.call("saved_save", { ...(existing === null ? {} : { id: existing.id }), connectionId: scoped ? connectionId : null, name: name.trim(), sql });
      toast.success(`Saved “${saved.name}”`);
      onSaved?.(saved);
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{existing === null ? "Save query" : "Update saved query"}</DialogTitle>
          <DialogDescription>Saved queries appear in the Saved tab of the side panel.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="saved-name" className="text-xs">
              Name
            </Label>
            <Input id="saved-name" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          </div>
          <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
            <span>
              Only for this connection
              <span className="block text-[11px] text-muted-foreground">Off makes it available on every connection.</span>
            </span>
            <Switch checked={scoped} onCheckedChange={setScoped} aria-label="Only for this connection" />
          </label>
          <pre className="max-h-40 overflow-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-[11px]">{sql}</pre>
          {error === null ? null : (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Spinner /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
