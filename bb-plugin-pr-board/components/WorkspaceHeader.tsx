import type { ReactNode } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { PullDetail, ReviewState } from "../contract";
import { BOARD_PANEL } from "../routes";
import { cn } from "../lib/utils";
import { Avatar, ToolbarToggle } from "./bits";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Icon } from "./ui/icon";

function SplitButton({
  label,
  icon,
  title,
  disabled,
  menuLabel,
  onClick,
  children,
}: {
  label: string;
  icon: string;
  title: string;
  disabled: boolean;
  menuLabel: string;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <div className="flex shrink-0">
      <Button size="sm" variant="outline" className="h-7 rounded-r-none px-2 text-xs" disabled={disabled} onClick={onClick} title={title}>
        <Icon name={icon} className="size-3.5" />
        {label}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="h-7 rounded-l-none border-l-0 px-1" title={menuLabel} aria-label={menuLabel}>
            <Icon name="ChevronDown" className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">{children}</DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function WorkspaceHeader({
  detail,
  review,
  narrow,
  refreshing,
  error,
  running,
  explaining,
  addressing,
  submittingAddress,
  onRefresh,
  onShowFindings,
  onRunReview,
  onExplain,
  onWatchVideo,
  onAddressComments,
  onSubmit,
  onSubmitAddress,
}: {
  detail: PullDetail;
  review: ReviewState;
  narrow: boolean;
  refreshing: boolean;
  error: string | null;
  running: boolean;
  explaining: boolean;
  addressing: boolean;
  submittingAddress: boolean;
  onRefresh(): void;
  onShowFindings(): void;
  onRunReview(): void;
  onExplain(): void;
  onWatchVideo(): void;
  onAddressComments(): void;
  onSubmit(): void;
  onSubmitAddress(): void;
}) {
  const navigate = useBbNavigate();
  const threadId = review.agent.threadId;
  const openUrl = (url: string) => {
    if (!navigate.openUrl(url)) window.open(url, "_blank", "noopener");
  };
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-border bg-card px-3 py-2">
      <Button
        size="icon"
        variant="ghost"
        className="size-8 shrink-0"
        title="Back to the board"
        aria-label="Back to the board"
        onClick={() => navigate.toPluginPanel(BOARD_PANEL)}
      >
        <Icon name="ArrowLeft" className="size-4" />
      </Button>
      <div className="min-w-0 flex-1 basis-64">
        <div className="flex items-center gap-2">
          {detail.isDraft ? (
            <span className="shrink-0 rounded border border-border px-1 text-[10px] font-medium uppercase text-muted-foreground">Draft</span>
          ) : null}
          <h1 className={cn("text-sm font-semibold", narrow ? "line-clamp-2" : "truncate")} title={detail.title}>
            {detail.title}
          </h1>
          <span className="shrink-0 text-sm text-muted-foreground">#{detail.number}</span>
          {error !== null && !refreshing ? (
            <button type="button" className="shrink-0 text-xs text-destructive underline-offset-2 hover:underline" title={error} onClick={onRefresh}>
              Update failed · retry
            </button>
          ) : (
            <Button
              size="icon"
              variant="ghost"
              className="size-6 shrink-0 text-muted-foreground"
              disabled={refreshing}
              title={refreshing ? "Updating…" : "Fetch the pull request from GitHub again"}
              aria-label={refreshing ? "Updating" : "Refresh"}
              onClick={onRefresh}
            >
              <Icon name="ArrowReloadHorizontal" className={cn("size-3", refreshing && "animate-spin")} />
            </Button>
          )}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          <span className="inline-flex shrink-0 items-center gap-1">
            <Avatar person={detail.author} />
            {detail.author.login}
          </span>
          <span aria-hidden>·</span>
          <span className="inline-flex min-w-0 max-w-full items-center gap-1">
            <Icon name="GitBranch" className="size-3 shrink-0" />
            <span className="truncate font-mono">
              {detail.headRefName} → {detail.baseRefName}
            </span>
          </span>
          <span aria-hidden>·</span>
          <span className="shrink-0 tabular-nums">
            <span className="text-diff-added">+{detail.additions}</span> <span className="text-diff-removed">−{detail.deletions}</span>
          </span>
          {review.agent.running ? (
            <span className="inline-flex shrink-0 items-center gap-1 text-timeline-accent">
              <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden />
              agent working
            </span>
          ) : null}
          {review.agent.findings > 0 ? (
            <button type="button" className="shrink-0 text-warning-text underline-offset-2 hover:underline" onClick={onShowFindings}>
              {review.agent.findings} findings
            </button>
          ) : null}
        </div>
      </div>
      <div className={cn("flex shrink-0 flex-wrap items-center gap-1", narrow && "w-full")}>
        <ToolbarToggle
          pressed={false}
          label="Thread"
          icon="MessageSquare"
          showLabel={!narrow}
          disabled={threadId === null}
          onClick={() => threadId !== null && navigate.toThread(threadId)}
        />
        {review.video === null ? null : <ToolbarToggle pressed={false} label="Video" icon="pr-board/video" showLabel={!narrow} onClick={onWatchVideo} />}
        <ToolbarToggle pressed={false} label="GitHub" icon="Github" showLabel={!narrow} onClick={() => openUrl(detail.url)} />
        <span className={cn("mx-1 h-5 w-px bg-border", narrow && "hidden")} aria-hidden />
        <span className={cn(narrow && "flex-1")} />
        <SplitButton
          label="Run review"
          icon="Play"
          title="Send /thermo-nuclear-code-quality-review to the review thread"
          disabled={running}
          menuLabel="More review actions"
          onClick={onRunReview}
        >
          <DropdownMenuItem
            disabled={explaining}
            onSelect={onExplain}
            title="Ask the review thread for a narrated video with diagrams of the problem, the implementation, and the findings"
          >
            <Icon name="pr-board/video" className="size-3.5" />
            {review.video === null ? "Explain in a video" : "Make a new video"}
          </DropdownMenuItem>
        </SplitButton>
        <SplitButton
          label="Address comments"
          icon="MessageCirclePlus"
          title={
            review.addressAgent.threadId === null
              ? "Start a thread that suggests code changes and replies for the PR's comments, without changing files"
              : "Ask the address thread to suggest changes and replies for the current comments again"
          }
          disabled={addressing}
          menuLabel="More address actions"
          onClick={onAddressComments}
        >
          <DropdownMenuItem
            disabled={submittingAddress || review.addressAgent.threadId === null}
            onSelect={onSubmitAddress}
            title={
              review.addressAgent.threadId === null
                ? "Click Address comments first"
                : `Check the accepted changes against the PR's GitHub Actions, then commit and push them to ${detail.headRefName}`
            }
          >
            <Icon name="Upload" className="size-3.5" />
            Submit Address
          </DropdownMenuItem>
        </SplitButton>
        <Button size="sm" className="h-7 shrink-0 px-2.5 text-xs" onClick={onSubmit}>
          Submit review
          {review.drafts.length > 0 ? <span className="rounded-full bg-background/25 px-1.5 tabular-nums">{review.drafts.length}</span> : null}
        </Button>
      </div>
    </header>
  );
}
