import { useState, type ReactNode } from "react";
import { Markdown } from "@get-bb/plugin-sdk/app";
import type { Draft, Finding, PullDetail, PullFile, ReviewState, Severity } from "../contract";
import { cn } from "../lib/utils";
import { Avatar, SeverityBadge, lineLabel } from "./bits";
import { CommentIndex, commentCount, type CommentFilter } from "./Comments";
import { Button } from "./ui/button";
import { Icon } from "./ui/icon";

export type PanelTab = "findings" | "overview" | "comments";

const SEVERITIES: readonly Severity[] = ["blocker", "major", "minor", "nit"];
const LAST = Number.MAX_SAFE_INTEGER;
const COMMENT_FILTERS: ReadonlyArray<{ id: CommentFilter; label: string }> = [
  { id: "waiting", label: "Waiting on you" },
  { id: "unresolved", label: "Unresolved" },
  { id: "all", label: "All" },
];

export function findingsInFileOrder(files: readonly PullFile[], findings: readonly Finding[]): Finding[] {
  const rank = new Map<string, number>();
  files.forEach((file, index) => {
    rank.set(file.path, index);
    if (file.previousPath !== null) rank.set(file.previousPath, index);
  });
  return [...findings].sort(
    (left, right) =>
      (rank.get(left.path) ?? LAST) - (rank.get(right.path) ?? LAST) ||
      left.path.localeCompare(right.path) ||
      (left.startLine ?? LAST) - (right.startLine ?? LAST),
  );
}

function PanelItem({ selected, dimmed, onClick, children }: { selected: boolean; dimmed?: boolean; onClick(): void; children: ReactNode }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "w-full rounded-md border border-border bg-background px-2 py-1.5 text-left text-xs outline-none hover:border-ring/60 focus-visible:ring-1 focus-visible:ring-ring",
          selected && "border-ring ring-1 ring-ring",
          dimmed && "opacity-50",
        )}
      >
        {children}
      </button>
    </li>
  );
}

function FindingsTab({
  files,
  review,
  focusedFindingId,
  onSelectFinding,
  onSelectDraft,
  onDismissAllFindings,
}: {
  files: readonly PullFile[];
  review: ReviewState;
  focusedFindingId: string | null;
  onSelectFinding(finding: Finding): void;
  onSelectDraft(draft: Draft): void;
  onDismissAllFindings(): void;
}) {
  const [showDismissed, setShowDismissed] = useState(false);
  const open = review.findings.filter((finding) => !finding.dismissed);
  const dismissed = review.findings.length - open.length;
  const listed = findingsInFileOrder(files, showDismissed ? review.findings : open);
  const groups = new Map<string, Finding[]>();
  for (const finding of listed) groups.set(finding.path, [...(groups.get(finding.path) ?? []), finding]);
  const viewed = new Set(files.filter((file) => file.viewed).flatMap((file) => [file.path, file.previousPath ?? file.path]));
  return (
    <div className="space-y-3">
      {open.length === 0 ? null : (
        <div className="flex flex-wrap items-center gap-1">
          {SEVERITIES.map((severity) => {
            const count = open.filter((finding) => finding.severity === severity).length;
            return count === 0 ? null : (
              <span key={severity} className="inline-flex items-center gap-1 text-[11px] tabular-nums text-muted-foreground">
                <SeverityBadge severity={severity} />
                {count}
              </span>
            );
          })}
          <span className="flex-1" />
          <button
            type="button"
            className="rounded px-1 py-0.5 text-[11px] font-medium text-muted-foreground outline-none hover:bg-state-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
            onClick={onDismissAllFindings}
          >
            Dismiss all
          </button>
        </div>
      )}
      {listed.length === 0 ? (
        <p className="px-2 py-6 text-center text-xs text-muted-foreground">
          {dismissed > 0 ? "Every finding is dismissed." : "No findings yet. They appear here when the review thread records them."}
        </p>
      ) : (
        [...groups].map(([path, findings]) => (
          <section key={path} aria-label={path}>
            <p className="mb-1 flex items-center gap-1 px-0.5 font-mono text-[11px] text-muted-foreground">
              <span className="min-w-0 flex-1 truncate">{path}</span>
              {viewed.has(path) ? <Icon name="Check" className="size-3 text-success" aria-label="Viewed" /> : null}
            </p>
            <ul className="space-y-1">
              {findings.map((finding) => (
                <PanelItem key={finding.id} selected={finding.id === focusedFindingId} dimmed={finding.dismissed} onClick={() => onSelectFinding(finding)}>
                  <span className="flex items-center gap-1.5">
                    <SeverityBadge severity={finding.severity} />
                    <span className="font-mono text-[11px] text-muted-foreground">{lineLabel(finding.startLine, finding.endLine)}</span>
                    {finding.dismissed ? <span className="text-[10px] text-muted-foreground">dismissed</span> : null}
                  </span>
                  <span className="mt-0.5 block font-medium">{finding.title}</span>
                </PanelItem>
              ))}
            </ul>
          </section>
        ))
      )}
      {dismissed > 0 ? (
        <button
          type="button"
          className="w-full px-2 py-1 text-left text-[11px] text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => setShowDismissed((value) => !value)}
        >
          {showDismissed ? "Hide" : "Show"} {dismissed} dismissed
        </button>
      ) : null}
      {review.drafts.length === 0 ? null : (
        <section aria-label="Your pending comments">
          <p className="mb-1 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Your pending comments</p>
          <ul className="space-y-1">
            {review.drafts.map((draft) => (
              <PanelItem key={draft.id} selected={false} onClick={() => onSelectDraft(draft)}>
                <span className="block truncate font-mono text-[11px] text-muted-foreground">
                  {draft.path} {lineLabel(draft.startLine, draft.endLine)}
                </span>
                <span className="mt-0.5 line-clamp-2 block">{draft.body}</span>
              </PanelItem>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

function OverviewTab({ detail, files, review, onOpenThread }: { detail: PullDetail; files: readonly PullFile[]; review: ReviewState; onOpenThread(threadId: string): void }) {
  const viewed = files.filter((file) => file.viewed).length;
  const thread = (label: string, threadId: string | null, running: boolean) =>
    threadId === null ? (
      <span className="text-muted-foreground">Not started</span>
    ) : (
      <button type="button" className="inline-flex items-center gap-1 underline-offset-2 hover:underline" onClick={() => onOpenThread(threadId)}>
        {running ? <span className="size-1.5 animate-pulse rounded-full bg-timeline-accent" aria-hidden /> : null}
        {running ? "Working" : "Open"} {label}
      </button>
    );
  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-border bg-background p-3" aria-label="Description">
        <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Avatar person={detail.author} />
          <span className="font-medium text-foreground">{detail.author.login}</span>
          wrote
        </p>
        <Markdown content={detail.body.trim().length === 0 ? "_No description provided._" : detail.body} className="text-sm" />
      </section>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 rounded-lg border border-border bg-background p-3 text-xs">
        <Fact label="Branch">
          <span className="break-all font-mono">
            {detail.headRefName} → {detail.baseRefName}
          </span>
        </Fact>
        <Fact label="Changes">
          <span className="tabular-nums">
            <span className="text-diff-added">+{detail.additions}</span> <span className="text-diff-removed">−{detail.deletions}</span> in {files.length} files
          </span>
        </Fact>
        <Fact label="You viewed">
          <span className="tabular-nums">
            {viewed} of {files.length} files
          </span>
        </Fact>
        <Fact label="Review">{thread("review thread", review.agent.threadId, review.agent.running)}</Fact>
        <Fact label="Address">{thread("address thread", review.addressAgent.threadId, review.addressAgent.running)}</Fact>
      </dl>
    </div>
  );
}

export function ReviewPanel({
  detail,
  files,
  review,
  tab,
  focusedFindingId,
  selectedCommentId,
  onTab,
  onClose,
  onSelectFinding,
  onSelectDraft,
  onDismissAllFindings,
  onSelectComment,
  onOpenThread,
}: {
  detail: PullDetail;
  files: readonly PullFile[];
  review: ReviewState;
  tab: PanelTab;
  focusedFindingId: string | null;
  selectedCommentId: string | null;
  onTab(tab: PanelTab): void;
  onClose: (() => void) | null;
  onSelectFinding(finding: Finding): void;
  onSelectDraft(draft: Draft): void;
  onDismissAllFindings(): void;
  onSelectComment(id: string): void;
  onOpenThread(threadId: string): void;
}) {
  const [filter, setFilter] = useState<CommentFilter>("waiting");
  const openFindings = review.findings.filter((finding) => !finding.dismissed).length;
  const labels: Record<PanelTab, string> = {
    findings: `Findings ${openFindings}`,
    overview: "Overview",
    comments: `Comments ${commentCount(detail)}`,
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border p-1.5" role="tablist">
        {(["findings", "overview", "comments"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => onTab(id)}
            className="flex-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring aria-selected:bg-state-active aria-selected:text-foreground"
          >
            {labels[id]}
          </button>
        ))}
        {onClose === null ? null : (
          <Button size="icon" variant="ghost" className="size-7 shrink-0" title="Close the panel" aria-label="Close the panel" onClick={onClose}>
            <Icon name="X" className="size-3.5" />
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
        {tab === "findings" ? (
          <FindingsTab
            files={files}
            review={review}
            focusedFindingId={focusedFindingId}
            onSelectFinding={onSelectFinding}
            onSelectDraft={onSelectDraft}
            onDismissAllFindings={onDismissAllFindings}
          />
        ) : tab === "overview" ? (
          <OverviewTab detail={detail} files={files} review={review} onOpenThread={onOpenThread} />
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1" role="group" aria-label="Show comments">
              {COMMENT_FILTERS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={filter === option.id}
                  onClick={() => setFilter(option.id)}
                  className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background"
                >
                  {option.label}
                </button>
              ))}
            </div>
            <CommentIndex detail={detail} suggestions={review.suggestions} selectedId={selectedCommentId} filter={filter} onSelect={onSelectComment} />
          </div>
        )}
      </div>
    </div>
  );
}
