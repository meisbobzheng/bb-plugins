import { useEffect, useMemo, useRef, useState } from "react";
import { experimental_copyToClipboard } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { Job, Overview } from "../contract";
import { BB_ITEM_LABELS, KIND_GROUPS, KIND_LABELS, type AppClass, type ScanItem } from "../kit";
import { cn } from "../lib/utils";
import { errorMessage, useOverview, useTravelKitRpc } from "./hooks";
import { Button } from "./ui/button";

type Tab = "kit" | "handback";

export function TravelKitPage() {
  const { overview, setOverview, error, refresh } = useOverview();
  const [tab, setTab] = useState<Tab>("kit");
  useEffect(() => {
    if (overview?.mode === "travel") setTab("handback");
  }, [overview?.mode]);
  if (overview === null) {
    return <p className="p-6 text-sm text-muted-foreground">{error ?? "Loading…"}</p>;
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
        <h1 className="text-base font-semibold">Travel Kit</h1>
        <span className="rounded border border-border px-1.5 py-px text-[11px] text-muted-foreground">
          {overview.mode === "travel" ? `Travel laptop · handbacks go to ${overview.handback?.repo}` : "Main laptop"}
        </span>
        <nav className="ml-auto flex gap-1" aria-label="Travel Kit sections">
          {(["kit", "handback"] as const).map((value) => (
            <Button key={value} size="sm" variant={tab === value ? "secondary" : "ghost"} onClick={() => setTab(value)}>
              {value === "kit" ? "Kit" : "Handback"}
            </Button>
          ))}
        </nav>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {tab === "kit" ? (
          <KitTab overview={overview} onProfile={(profile) => setOverview({ ...overview, profile })} onChanged={refresh} />
        ) : (
          <HandbackTab overview={overview} />
        )}
      </div>
    </div>
  );
}

function KitTab({
  overview,
  onProfile,
  onChanged,
}: {
  overview: Overview;
  onProfile: (profile: Overview["profile"]) => void;
  onChanged: () => void;
}) {
  const rpc = useTravelKitRpc();
  const [scanning, setScanning] = useState(false);
  const [filter, setFilter] = useState("");
  const excluded = useMemo(() => new Set(overview.profile.excluded), [overview.profile.excluded]);
  const running = overview.job !== null && overview.job.finishedAt === null;
  const items = overview.scan?.items ?? [];
  const included = items.filter((item) => !excluded.has(item.key)).length;

  const scan = () => {
    setScanning(true);
    rpc
      .call("scan", null)
      .then(onChanged, (cause: unknown) => toast.error(errorMessage(cause)))
      .finally(() => setScanning(false));
  };
  const toggle = (keys: string[], include: boolean) =>
    rpc.call("setIncluded", { keys, included: include }).then(onProfile, (cause: unknown) => toast.error(errorMessage(cause)));
  const setClass = (name: string, appClass: AppClass) =>
    rpc.call("setAppClass", { name, appClass }).then(onProfile, (cause: unknown) => toast.error(errorMessage(cause)));
  const generate = () => rpc.call("generate", null).then(onChanged, (cause: unknown) => toast.error(errorMessage(cause)));

  const needle = filter.trim().toLowerCase();
  const visible = needle === "" ? items : items.filter((item) => `${item.name} ${KIND_LABELS[item.kind] ?? item.kind}`.toLowerCase().includes(needle));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <section className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={scan} disabled={scanning || running}>
          {scanning ? "Scanning…" : overview.scan === null ? "Scan this Mac" : "Scan again"}
        </Button>
        <Button size="sm" onClick={generate} disabled={running || items.length === 0}>
          Generate kit
        </Button>
        <p className="text-xs text-muted-foreground">
          {overview.scan === null
            ? "Scan to see everything a kit can include."
            : `${included} of ${items.length} items · scanned ${new Date(overview.scan.scannedAt).toLocaleString()} · saves to ${overview.outputDir} · threads from the last ${overview.days} days`}
        </p>
      </section>
      <JobPanel job={overview.job} />
      {items.length > 0 && (
        <input
          className="h-8 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          placeholder="Filter items"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      )}
      {KIND_GROUPS.map(({ group, kinds }) => {
        const rows = visible.filter((item) => (kinds as readonly string[]).includes(item.kind));
        if (rows.length === 0) return null;
        const on = rows.filter((item) => !excluded.has(item.key)).length;
        return (
          <section key={group} className="rounded-lg border border-border">
            <header className="flex items-center gap-2 border-b border-border px-3 py-2">
              <input
                type="checkbox"
                aria-label={`Include all ${group}`}
                checked={on === rows.length}
                ref={(element) => {
                  if (element !== null) element.indeterminate = on > 0 && on < rows.length;
                }}
                onChange={(event) => void toggle(rows.map((item) => item.key), event.target.checked)}
              />
              <h2 className="text-sm font-medium">{group}</h2>
              <span className="text-xs text-muted-foreground">
                {on} of {rows.length}
              </span>
            </header>
            <ul className="divide-y divide-border">
              {rows.map((item) => (
                <ItemRow key={item.key} item={item} included={!excluded.has(item.key)} appClass={overview.profile.classes[item.key]} onToggle={toggle} onClass={setClass} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function ItemRow({
  item,
  included,
  appClass,
  onToggle,
  onClass,
}: {
  item: ScanItem;
  included: boolean;
  appClass: AppClass | undefined;
  onToggle: (keys: string[], include: boolean) => void;
  onClass: (name: string, appClass: AppClass) => void;
}) {
  const detail = item.kind === "bb" ? BB_ITEM_LABELS[item.name] : item.kind === "repo" ? item.extra || "no remote" : item.version;
  return (
    <li className={cn("flex items-center gap-2 px-3 py-1.5 text-sm", !included && "opacity-50")}>
      <input type="checkbox" aria-label={`Include ${item.name}`} checked={included} onChange={(event) => onToggle([item.key], event.target.checked)} />
      <span className="min-w-0 truncate font-medium">{item.kind === "bb" && item.name === "threads" ? `Threads (${item.version})` : item.name}</span>
      <span className="shrink-0 rounded border border-border px-1.5 py-px text-[11px] text-muted-foreground">{KIND_LABELS[item.kind] ?? item.kind}</span>
      {detail !== undefined && detail !== "" && <span className="min-w-0 truncate text-xs text-muted-foreground">{detail}</span>}
      {item.kind === "app" && (
        <select
          aria-label={`How ${item.name} gets installed`}
          className="ml-auto h-7 rounded-md border border-input bg-transparent px-1 text-xs"
          value={appClass ?? "iru"}
          onChange={(event) => onClass(item.name, event.target.value as AppClass)}
        >
          <option value="iru">Iru Self Service</option>
          <option value="manual">Download it myself</option>
        </select>
      )}
    </li>
  );
}

function JobPanel({ job }: { job: Job | null }) {
  const rpc = useTravelKitRpc();
  const log = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (log.current !== null) log.current.scrollTop = log.current.scrollHeight;
  }, [job?.lines.length]);
  if (job === null) return null;
  const running = job.finishedAt === null;
  const title = job.kind === "generate" ? "Kit" : "Handback";
  const status = running ? "running…" : job.exitCode === 0 ? "finished" : `failed (exit ${job.exitCode})`;
  return (
    <section className="rounded-lg border border-border" aria-live="polite">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm">
        <span className="font-medium">{title}</span>
        <span className={cn("text-xs", !running && job.exitCode !== 0 ? "text-destructive" : "text-muted-foreground")}>{status}</span>
        {running && (
          <Button className="ml-auto" size="sm" variant="ghost" onClick={() => void rpc.call("cancel", null)}>
            Cancel
          </Button>
        )}
        {job.artifact !== null && (
          <Button className="ml-auto" size="sm" variant="outline" onClick={() => void rpc.call("reveal", { path: job.artifact! }).catch((cause: unknown) => toast.error(errorMessage(cause)))}>
            Show in Finder
          </Button>
        )}
      </header>
      <pre ref={log} className="max-h-72 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-xs leading-5 text-muted-foreground">
        {job.lines.join("\n") || "Starting…"}
      </pre>
      {job.artifact !== null && (
        <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
          Copy <span className="font-mono text-foreground">{job.artifact}</span> to the travel laptop, unzip it, and run{" "}
          <span className="font-mono text-foreground">./install.sh</span> in Terminal. Run it again any time; it picks up where it stopped.
        </p>
      )}
    </section>
  );
}

function HandbackTab({ overview }: { overview: Overview }) {
  const rpc = useTravelKitRpc();
  const running = overview.job !== null && overview.job.finishedAt === null;
  const [repos, setRepos] = useState<{ repos: string[]; error: string | null } | null>(null);
  useEffect(() => {
    if (overview.mode === "main") void rpc.call("handbackRepos", null).then(setRepos, (cause: unknown) => setRepos({ repos: [], error: errorMessage(cause) }));
  }, [overview.mode, rpc]);
  const start = (dryRun: boolean) => rpc.call("handback", { dryRun }).catch((cause: unknown) => toast.error(errorMessage(cause)));

  if (overview.mode === "travel" && overview.handback !== null) {
    const since = new Date(overview.handback.sinceMs).toLocaleString();
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        <p className="text-sm">
          Handbacks go to the private repo <span className="font-mono">{overview.handback.repo}</span>. {overview.handback.pushed} pushed so far; the next
          one covers what changed since {since}.
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={running} onClick={() => void start(true)}>
            Preview changes
          </Button>
          <Button size="sm" disabled={running} onClick={() => void start(false)}>
            Push handback
          </Button>
        </div>
        <JobPanel job={overview.job?.kind === "handback" ? overview.job : null} />
      </div>
    );
  }

  const command = `zsh '${overview.runner}' apply`;
  const applied = new Map(overview.applied.map(({ repo, seq }) => [repo, seq]));
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 text-sm">
      <p>
        Each travel laptop pushes its handbacks to a private <span className="font-mono">travel-kit-*</span> repo on your GitHub account. Applying them quits bb
        for a moment to merge threads, so run it from Terminal:
      </p>
      <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
        <code className="min-w-0 flex-1 truncate font-mono text-xs">{command}</code>
        <Button size="sm" variant="outline" onClick={() => void experimental_copyToClipboard({ text: command }).then((ok) => ok && toast.success("Copied"))}>
          Copy
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Threads take the travel copy. For apps, packages, dotfiles, and config it asks you item by item, and your old copy goes to ~/.travel-kit/backups.
      </p>
      <section className="rounded-lg border border-border">
        <header className="border-b border-border px-3 py-2 font-medium">Handback repos</header>
        {repos === null ? (
          <p className="px-3 py-2 text-muted-foreground">Looking on GitHub…</p>
        ) : repos.error !== null ? (
          <p className="px-3 py-2 text-muted-foreground">Couldn't list repos: {repos.error}</p>
        ) : repos.repos.length === 0 ? (
          <p className="px-3 py-2 text-muted-foreground">None yet. A travel laptop creates one when its install finishes.</p>
        ) : (
          <ul className="divide-y divide-border">
            {repos.repos.map((repo) => {
              const name = repo.split("/").at(-1) ?? repo;
              return (
                <li key={repo} className="flex items-center gap-2 px-3 py-1.5">
                  <span className="font-mono">{repo}</span>
                  <span className="text-xs text-muted-foreground">{applied.has(name) ? `applied through handback ${applied.get(name)}` : "not applied yet"}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
