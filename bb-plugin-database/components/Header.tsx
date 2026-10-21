import { useState } from "react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { Connection } from "../contract";
import { Confirm } from "./bits";
import { ConnectionDialog } from "./ConnectionDialog";
import { errorMessage, refreshSession, useDbRpc, useSessionSync } from "./hooks";
import { activeConnection } from "./session";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Icon } from "./ui/icon";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Switch } from "./ui/switch";

export function DatabaseHeader(_props: PluginNavPanelProps) {
  const rpc = useDbRpc();
  const session = useSessionSync();
  const connection = activeConnection(session);
  const [dialog, setDialog] = useState<{ connection: Connection | null } | null>(null);
  const [databases, setDatabases] = useState<{ connectionId: string; names: string[] } | null>(null);
  const [loadingDatabases, setLoadingDatabases] = useState(false);
  const [confirmWrites, setConfirmWrites] = useState(false);

  const activate = async (id: string) => {
    try {
      await rpc.call("connections_activate", { id });
      await refreshSession(rpc);
    } catch (cause) {
      toast.error(errorMessage(cause));
    }
  };

  const loadDatabases = async () => {
    if (connection === null || loadingDatabases || databases?.connectionId === connection.id) return;
    setLoadingDatabases(true);
    try {
      const { databases: names } = await rpc.call("databases_list", { connectionId: connection.id });
      setDatabases({ connectionId: connection.id, names });
    } catch (cause) {
      toast.error(`Could not list databases: ${errorMessage(cause)}`);
    } finally {
      setLoadingDatabases(false);
    }
  };

  const switchDatabase = async (database: string) => {
    if (connection === null || database === connection.database) return;
    try {
      await rpc.call("connections_set_database", { id: connection.id, database });
      await refreshSession(rpc);
      toast.success(`Switched to ${database}`);
    } catch (cause) {
      toast.error(errorMessage(cause));
    }
  };

  const setWrites = async (allowWrites: boolean) => {
    if (connection === null) return;
    setConfirmWrites(false);
    try {
      await rpc.call("connections_set_writes", { id: connection.id, allowWrites });
      await refreshSession(rpc);
      toast.success(allowWrites ? `Writes enabled on ${connection.name}` : `${connection.name} is read-only again`);
    } catch (cause) {
      toast.error(errorMessage(cause));
    }
  };

  const databaseOptions = connection === null ? [] : [...new Set([connection.database, ...(databases?.connectionId === connection.id ? databases.names : [])])];

  return (
    <div className="flex items-center gap-1.5">
      {connection === null ? (
        <Button size="sm" className="h-7 text-xs" onClick={() => setDialog({ connection: null })}>
          <Icon name="Plus" className="size-3.5" />
          Add connection
        </Button>
      ) : (
        <>
          <Select value={connection.id} onValueChange={(id) => void activate(id)}>
            <SelectTrigger className="h-7 w-auto min-w-36 gap-1.5 text-xs" aria-label="Connection">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {session.connections.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={connection.database} onValueChange={(database) => void switchDatabase(database)} onOpenChange={(open) => (open ? void loadDatabases() : undefined)}>
            <SelectTrigger className="h-7 w-auto min-w-28 gap-1.5 font-mono text-xs" aria-label="Database">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {databaseOptions.map((name) => (
                <SelectItem key={name} value={name} className="font-mono text-xs">
                  {name}
                </SelectItem>
              ))}
              {loadingDatabases ? <div className="px-2 py-1 text-xs text-muted-foreground">Loading…</div> : null}
            </SelectContent>
          </Select>
          <label className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 text-xs" title="Statements run in a read-only session until writes are enabled">
            <Switch checked={connection.allowWrites} onCheckedChange={(checked) => (checked ? setConfirmWrites(true) : void setWrites(false))} aria-label="Allow writes" className="scale-75" />
            {connection.allowWrites ? <span className="font-medium text-amber-600 dark:text-amber-400">Writes on</span> : <span className="text-muted-foreground">Read-only</span>}
          </label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-7 w-7 px-0" aria-label="Connection menu">
                <Icon name="Settings" className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setDialog({ connection })}>Edit {connection.name}…</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setDialog({ connection: null })}>New connection…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
      <ConnectionDialog open={dialog !== null} connection={dialog?.connection ?? null} onClose={() => setDialog(null)} onSaved={(saved) => void activate(saved.id)} />
      <Dialog open={confirmWrites} onOpenChange={(open) => (open ? undefined : setConfirmWrites(false))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Allow writes on {connection?.name}?</DialogTitle>
            <DialogDescription>
              Statements will be able to change data in <span className="font-mono">{connection?.database}</span> on <span className="font-mono">{connection?.host}</span>. Queries generated from plain
              language still never run writes on their own.
            </DialogDescription>
          </DialogHeader>
          <Confirm title="" body={null} confirmLabel="Enable writes" destructive onConfirm={() => void setWrites(true)} onCancel={() => setConfirmWrites(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
