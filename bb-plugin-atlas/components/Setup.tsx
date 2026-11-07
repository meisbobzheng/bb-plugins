import { useState, type FormEvent } from "react";
import type { Snapshot } from "../contract";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { errorText, useAtlasRpc } from "./useSnapshot";

export function Setup({ snapshot, onReady }: { snapshot: Snapshot; onReady: (next: Snapshot) => void }) {
  const rpc = useAtlasRpc();
  const [directory, setDirectory] = useState(snapshot.directory === "" ? "~/atlas" : snapshot.directory);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = (method: "createExample" | "useDirectory") => {
    setBusy(true);
    setError(null);
    rpc.call(method, { directory }).then(
      (next) => {
        setBusy(false);
        onReady(next);
      },
      (cause: unknown) => {
        setBusy(false);
        setError(errorText(cause));
      },
    );
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    run("useDirectory");
  };

  return (
    <div className="flex h-full items-center justify-center overflow-auto p-6">
      <form onSubmit={submit} className="w-full max-w-lg space-y-4">
        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold">Map your systems from the top down</h2>
          <p className="text-sm text-muted-foreground">
            An atlas is a folder of YAML files, one diagram per file. Each system opens into the diagram below it, so you can zoom from the whole network into a single service.
          </p>
          {snapshot.status === "missing" && <p className="text-sm text-warning-text">{snapshot.directory} doesn't exist yet.</p>}
        </div>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Atlas folder</span>
          <Input value={directory} onChange={(event) => setDirectory(event.target.value)} spellCheck={false} aria-label="Atlas folder" />
        </label>
        {error !== null && <p className="text-sm text-destructive-text">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy} onClick={() => run("createExample")}>
            Create an example atlas
          </Button>
          <Button type="submit" variant="secondary" disabled={busy}>
            Open this folder
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Agents can write and check the atlas too: ask one to map a system, or run <code className="font-mono">bb atlas init ~/atlas</code>.
        </p>
      </form>
    </div>
  );
}
