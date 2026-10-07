import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { UPDATES_CHANNEL } from "../channel";
import type { BoardCard, Checks, Column, ReviewerState, rpcContract } from "../contract";
import { BOARD_PANEL, workspacePath } from "../routes";
import { cn } from "../lib/utils";
import { Avatar, relativeTime } from "./bits";
import { Button } from "./ui/button";
import { Icon } from "./ui/icon";
import { Input } from "./ui/input";
import { useLoad } from "./use-load";

const COLUMNS: ReadonlyArray<{ id: Column; title: string; hint: string }> = [
  { id: "draft", title: "Draft", hint: "Draft pull requests" },
  { id: "open", title: "Open", hint: "Ready for review, no human comments yet" },
  { id: "reviewing", title: "Reviewing", hint: "Commented on by someone other than the author, a bot, or Copilot" },
  { id: "ready", title: "Ready", hint: "Approved" },
];

type Scope = "all" | "requested" | "mine";

const SCOPES: ReadonlyArray<{ id: Scope; label: string }> = [
  { id: "all", label: "All" },
  { id: "requested", label: "Requested" },
  { id: "mine", label: "Mine" },
];

const REFRESH_MS = 60_000;

const CHECK_STYLES: Record<Checks, { className: string; label: string } | null> = {
  success: { className: "bg-emerald-500", label: "Checks passed" },
  failure: { className: "bg-red-500", label: "Checks failed" },
  pending: { className: "bg-amber-400 animate-pulse", label: "Checks running" },
  none: null,
};

const REVIEWER_RING: Record<ReviewerState, string> = {
  approved: "ring-emerald-500",
  "changes-requested": "ring-red-500",
  commented: "ring-sky-500",
  requested: "ring-border opacity-60",
};

function matches(card: BoardCard, query: string, scope: Scope): boolean {
  if (scope === "requested" && !card.isRequested) return false;
  if (scope === "mine" && !card.isAuthor) return false;
  if (query.length === 0) return true;
  const haystack = `${card.repo}#${card.number} ${card.title} ${card.author.login} ${card.headRefName}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((term) => haystack.includes(term));
}

function AgentBadge({ card }: { card: BoardCard }) {
  if (card.agent.threadId === null) return null;
  if (card.agent.running) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-sky-600 dark:text-sky-400">
        <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden />
        Agent working
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px]",
        card.agent.findings > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
      )}
    >
      <Icon name="Bot" className="size-3" aria-hidden />
      {card.agent.findings > 0 ? `${card.agent.findings} findings` : "Reviewed"}
    </span>
  );
}

function PullCard({ card, showRepo, onOpen }: { card: BoardCard; showRepo: boolean; onOpen: (card: BoardCard) => void }) {
  const navigate = useBbNavigate();
  const checks = CHECK_STYLES[card.checks];
  const openExternal = (event: MouseEvent) => {
    event.stopPropagation();
    if (!navigate.openUrl(card.url)) window.open(card.url, "_blank", "noopener");
  };
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(card)}
        onKeyDown={(event) => {
          if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            onOpen(card);
          }
        }}
        className="group block cursor-pointer space-y-2 rounded-lg border border-border bg-card p-3 text-left text-sm shadow-xs outline-none transition-colors hover:border-foreground/20 hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {checks === null ? null : (
                <span className={cn("size-2 shrink-0 rounded-full", checks.className)} title={checks.label} aria-label={checks.label} />
              )}
              <span className="tabular-nums">
                {showRepo ? card.repo.slice(card.repo.indexOf("/") + 1) : ""}#{card.number}
              </span>
              <span aria-hidden>·</span>
              <span title={new Date(card.updatedAt).toLocaleString()}>{relativeTime(card.updatedAt)}</span>
            </div>
            <p className="mt-0.5 line-clamp-2 font-medium leading-snug">{card.title}</p>
          </div>
          <button
            type="button"
            onClick={openExternal}
            className="shrink-0 rounded-md p-1 text-muted-foreground opacity-0 outline-none transition-opacity hover:bg-state-hover hover:text-foreground focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100"
            title="Open on GitHub"
            aria-label={`Open #${card.number} on GitHub`}
          >
            <Icon name="ExternalLink" className="size-3.5" />
          </button>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex min-w-0 items-center gap-1">
            <Avatar person={card.author} />
            <span className="truncate">{card.author.login}</span>
          </span>
          <span className="ml-auto shrink-0 tabular-nums">
            <span className="text-emerald-600 dark:text-emerald-400">+{card.additions}</span>{" "}
            <span className="text-red-600 dark:text-red-400">−{card.deletions}</span>
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {card.reviewers.length === 0 ? null : (
            <span className="flex -space-x-1">
              {card.reviewers.slice(0, 5).map((reviewer) => (
                <Avatar
                  key={reviewer.login}
                  person={reviewer}
                  className={cn("ring-2 ring-offset-1 ring-offset-card", REVIEWER_RING[reviewer.state])}
                  title={`${reviewer.login}: ${reviewer.state.replace("-", " ")}`}
                />
              ))}
            </span>
          )}
          {card.humanComments > 0 ? (
            <span className="inline-flex items-center gap-0.5" title="Comments and reviews from people">
              <Icon name="MessageSquare" className="size-3" aria-hidden />
              {card.humanComments}
            </span>
          ) : null}
          {card.unresolvedThreads > 0 ? (
            <span className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400" title="Unresolved review threads">
              <Icon name="AlertCircle" className="size-3" aria-hidden />
              {card.unresolvedThreads}
            </span>
          ) : null}
          <span className="ml-auto">
            <AgentBadge card={card} />
          </span>
        </div>
      </div>
    </li>
  );
}

export function BoardView() {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [board, reload] = useLoad("board", () => rpc.call("board", { refresh: false }));
  useRealtime(UPDATES_CHANNEL, reload);
  useEffect(() => {
    const timer = setInterval(reload, REFRESH_MS);
    return () => clearInterval(timer);
  }, [reload]);

  const refresh = () => {
    setRefreshing(true);
    rpc
      .call("board", { refresh: true })
      .then(reload)
      .finally(() => setRefreshing(false));
  };

  const open = (card: BoardCard) => navigate.toPluginPanel(BOARD_PANEL, { subPath: workspacePath(card) });

  const columns = useMemo(() => {
    const cards = board.status === "ready" ? board.value.cards.filter((card) => matches(card, query.trim(), scope)) : [];
    return COLUMNS.map((column) => ({ ...column, cards: cards.filter((card) => card.column === column.id) }));
  }, [board, query, scope]);

  if (board.status === "loading") {
    return <p className="p-5 text-sm text-muted-foreground">Loading open pull requests…</p>;
  }
  if (board.status === "error") {
    return (
      <div className="space-y-3 p-5 text-sm">
        <p className="text-destructive">{board.message}</p>
        <Button size="sm" variant="outline" onClick={reload}>
          Retry
        </Button>
      </div>
    );
  }

  const { repos, errors, fetchedAt, viewer } = board.value;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5 md:px-5">
        <div className="relative w-64 max-w-full">
          <Icon name="Search" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by title, author, branch, #"
            aria-label="Filter pull requests"
            className="h-8 pl-8 text-sm"
          />
        </div>
        <div className="flex rounded-md border border-border p-0.5" role="group" aria-label="Scope">
          {SCOPES.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={scope === option.id}
              onClick={() => setScope(option.id)}
              className="rounded px-2.5 py-1 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring aria-pressed:bg-state-active aria-pressed:text-foreground"
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-muted-foreground">
          {repos.join(", ")} as {viewer} · {relativeTime(fetchedAt)}
        </span>
        <Button size="sm" variant="outline" onClick={refresh} disabled={refreshing}>
          <Icon name="ArrowReloadHorizontal" className={cn("size-3.5", refreshing && "animate-spin")} />
          Refresh
        </Button>
      </div>
      {errors.map((error) => (
        <p key={error.repo} className="shrink-0 px-5 pt-2 text-sm text-destructive">
          {error.repo}: {error.message}
        </p>
      ))}
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4 md:p-5">
        {columns.map((column) => (
          <section key={column.id} className="flex min-h-0 w-72 min-w-64 flex-1 flex-col rounded-xl bg-muted/40 p-2" aria-label={column.title}>
            <header className="flex items-center gap-2 px-1.5 pb-2 pt-1" title={column.hint}>
              <h2 className="text-sm font-semibold">{column.title}</h2>
              <span className="rounded-full bg-background px-1.5 text-xs tabular-nums text-muted-foreground">{column.cards.length}</span>
            </header>
            <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto px-0.5 pb-1">
              {column.cards.map((card) => (
                <PullCard key={`${card.repo}#${card.number}`} card={card} showRepo={repos.length > 1} onOpen={open} />
              ))}
              {column.cards.length === 0 ? <li className="px-1.5 py-6 text-center text-xs text-muted-foreground">Nothing here</li> : null}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
