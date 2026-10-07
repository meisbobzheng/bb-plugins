import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Markdown, experimental_useAppPanel, useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { UPDATES_CHANNEL } from "../channel";
import type {
  Definition,
  DefinitionResult,
  Finding,
  PullDetail,
  PullFile,
  ReviewEvent,
  ReviewState,
  rpcContract,
} from "../contract";
import type { DiffStyle } from "../highlight";
import { isCommentable } from "../patch";
import { BOARD_PANEL, REVIEW_THREAD_TAB, type PullRoute } from "../routes";
import type { Composer, ReviewActions } from "./Annotations";
import { Avatar } from "./bits";
import { DiffPane, type DefinitionRequest, type DiffFocus } from "./DiffPane";
import { DefinitionPicker, PeekPane, type PeekTarget } from "./PeekPane";
import { Sidebar, type SidebarTab } from "./Sidebar";
import { SubmitReviewDialog } from "./SubmitReview";
import { Button } from "./ui/button";
import { Icon } from "./ui/icon";
import { errorMessage, useLoad } from "./use-load";
import { usePreference } from "./use-preference";

type Location = { kind: "diff"; path: string; focus: DiffFocus | null } | { kind: "peek"; target: PeekTarget };

const HISTORY_LIMIT = 50;
const DIFF_STYLES = ["split", "unified"] as const;

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

function samePull(payload: unknown, pull: PullRoute): boolean {
  if (typeof payload !== "object" || payload === null) return true;
  const { repo, number } = payload as { repo?: unknown; number?: unknown };
  return repo === pull.repo && number === pull.number;
}

function ToolbarToggle({ pressed, label, icon, onClick }: { pressed: boolean; label: string; icon: string; onClick(): void }) {
  return (
    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" aria-pressed={pressed} title={label} onClick={onClick}>
      <Icon name={icon} className="size-3.5" />
      <span className="hidden lg:inline">{label}</span>
    </Button>
  );
}

function useReviewThread(pull: PullRoute, onReady: () => void) {
  const rpc = useRpc<typeof rpcContract>();
  const appPanel = experimental_useAppPanel();
  const ready = useRef(onReady);
  ready.current = onReady;
  useEffect(() => {
    appPanel.openFixedTab({ surface: { kind: "current" }, tab: REVIEW_THREAD_TAB });
    let current = true;
    rpc
      .call("openReview", pull)
      .then((result) => {
        if (!current) return;
        if (result.created) toast.success("Started a review thread: it summarizes the PR, then runs the thermo-nuclear review.");
        ready.current();
      })
      .catch((error: unknown) => toast.error(`Could not open the review thread: ${errorMessage(error)}`));
    return () => {
      current = false;
    };
  }, [pull.repo, pull.number]);
}

export function ReviewWorkspace({ pull }: { pull: PullRoute }) {
  const rpc = useRpc<typeof rpcContract>();
  const key = `${pull.repo}#${pull.number}`;
  const [detail, reloadDetail] = useLoad(`detail:${key}`, () => rpc.call("pull", { ...pull, refresh: false }));
  const [state, reloadState] = useLoad(`state:${key}`, () => rpc.call("reviewState", pull));
  useRealtime(UPDATES_CHANNEL, (payload) => {
    if (samePull(payload, pull)) reloadState();
  });
  useReviewThread(pull, reloadState);
  const refreshDetail = useCallback(
    () => rpc.call("pull", { ...pull, refresh: true }).then(() => reloadDetail()),
    [pull.repo, pull.number, reloadDetail, rpc],
  );

  if (detail.status === "loading") return <p className="p-5 text-sm text-muted-foreground">Loading {key}…</p>;
  if (detail.status === "error") {
    return (
      <div className="space-y-3 p-5 text-sm">
        <p className="text-destructive">{detail.message}</p>
        <Button size="sm" variant="outline" onClick={reloadDetail}>
          Retry
        </Button>
      </div>
    );
  }
  return (
    <Workspace
      key={key}
      detail={detail.value}
      state={state.status === "ready" ? state.value : null}
      reloadState={reloadState}
      refreshDetail={refreshDetail}
    />
  );
}

const EMPTY_STATE: ReviewState = { agent: { threadId: null, running: false, findings: 0 }, findings: [], drafts: [] };

function Workspace({
  detail,
  state,
  reloadState,
  refreshDetail,
}: {
  detail: PullDetail;
  state: ReviewState | null;
  reloadState(): void;
  refreshDetail(): Promise<void>;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const pull = { repo: detail.repo, number: detail.number };
  const review = state ?? EMPTY_STATE;
  const [diffStyle, setDiffStyle] = usePreference<DiffStyle>("diff-style", "split", DIFF_STYLES);
  const [wrap, setWrap] = usePreference<boolean>("wrap", false);
  const [sidebarOpen, setSidebarOpen] = usePreference<boolean>("sidebar", true);
  const [tab, setTab] = useState<SidebarTab>("files");
  const [location, setLocation] = useState<Location | null>(null);
  const [history, setHistory] = useState<Location[]>([]);
  const [fullFiles, setFullFiles] = useState<ReadonlySet<string>>(new Set());
  const [composer, setComposer] = useState<Composer | null>(null);
  const [picker, setPicker] = useState<{ result: DefinitionResult; sha: string } | null>(null);
  const [viewed, setViewed] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [submitOpen, setSubmitOpen] = useState(false);
  const [showDescription, setShowDescription] = useState(false);
  const [running, setRunning] = useState(false);
  const seq = useRef(0);
  const nextSeq = () => ++seq.current;

  const files = useMemo(
    () => detail.files.map((file) => ({ ...file, viewed: viewed.get(file.path) ?? file.viewed })),
    [detail.files, viewed],
  );
  const firstPath = files[0]?.path;
  const current = useMemo(
    (): Location | null => location ?? (firstPath === undefined ? null : { kind: "diff", path: firstPath, focus: null }),
    [firstPath, location],
  );
  const currentFile = current?.kind === "diff" ? (files.find((file) => file.path === current.path) ?? null) : null;

  const goTo = useCallback(
    (next: Location, remember: boolean) => {
      if (remember && current !== null) setHistory((previous) => [...previous.slice(-HISTORY_LIMIT), current]);
      setLocation(next);
      setPicker(null);
    },
    [current],
  );
  const back = useCallback(() => {
    const last = history[history.length - 1];
    if (last === undefined) return;
    setHistory(history.slice(0, -1));
    setLocation(last.kind === "diff" && last.focus !== null ? { ...last, focus: { ...last.focus, seq: ++seq.current } } : last);
    setPicker(null);
  }, [history]);

  const selectFile = useCallback((path: string) => goTo({ kind: "diff", path, focus: null }, false), [goTo]);
  const stepFile = useCallback(
    (delta: number) => {
      const index = files.findIndex((file) => file.path === currentFile?.path);
      const next = files[Math.min(Math.max(index + delta, 0), files.length - 1)];
      if (next !== undefined) selectFile(next.path);
    },
    [currentFile?.path, files, selectFile],
  );

  const fileForFinding = (finding: Finding): PullFile | undefined =>
    files.find((file) => file.path === finding.path || file.previousPath === finding.path);

  const selectFinding = (finding: Finding) => {
    const file = fileForFinding(finding);
    if (file === undefined) {
      goTo({ kind: "peek", target: { kind: "repo", sha: detail.headSha, path: finding.path, line: finding.startLine ?? 1, seq: nextSeq() } }, true);
      return;
    }
    const focus =
      finding.startLine === null || finding.endLine === null
        ? null
        : { side: finding.side, line: finding.startLine, endLine: finding.endLine, seq: nextSeq() };
    goTo({ kind: "diff", path: file.path, focus }, true);
  };

  const jumpTo = (definition: Definition, sha: string) => {
    const focusAt = (side: DiffFocus["side"]): DiffFocus => ({ side, line: definition.line, endLine: definition.line, seq: nextSeq() });
    if (definition.external) {
      goTo({ kind: "peek", target: { kind: "external", path: definition.path, line: definition.line, seq: nextSeq() } }, true);
      return;
    }
    if (sha === detail.headSha) {
      const file = files.find((candidate) => candidate.path === definition.path && candidate.status !== "removed");
      if (file !== undefined) return goTo({ kind: "diff", path: file.path, focus: focusAt("additions") }, true);
    }
    if (sha === detail.mergeBaseSha) {
      const file = files.find((candidate) => (candidate.previousPath ?? candidate.path) === definition.path && candidate.status !== "added");
      if (file !== undefined) return goTo({ kind: "diff", path: file.path, focus: focusAt("deletions") }, true);
    }
    goTo({ kind: "peek", target: { kind: "repo", sha, path: definition.path, line: definition.line, seq: nextSeq() } }, true);
  };

  const findDefinition = (request: DefinitionRequest) => {
    const id = toast.loading(`Finding ${request.symbol}…`);
    rpc
      .call("definition", { ...pull, ...request })
      .then((result) => {
        toast.dismiss(id);
        const [only, ...rest] = result.definitions;
        if (only === undefined) toast(result.message ?? `No definition of ${request.symbol} found.`);
        else if (rest.length === 0) jumpTo(only, request.sha);
        else setPicker({ result, sha: request.sha });
      })
      .catch((error: unknown) => toast.error(errorMessage(error), { id }));
  };

  const actions: ReviewActions = {
    async saveDraft(target, body) {
      await rpc.call("saveDraft", {
        ...pull,
        id: target.draftId,
        path: target.path,
        side: target.side,
        startLine: target.startLine,
        endLine: target.endLine,
        body,
      });
      setComposer(null);
      reloadState();
    },
    async deleteDraft(id) {
      await rpc.call("deleteDraft", { id });
      reloadState();
    },
    async postComment(target, body) {
      await rpc.call("postComment", {
        ...pull,
        headSha: detail.headSha,
        path: target.path,
        side: target.side,
        startLine: target.startLine,
        endLine: target.endLine,
        body,
      });
      setComposer(null);
      toast.success("Comment posted");
      await refreshDetail();
    },
    async reply(commentId, body) {
      await rpc.call("reply", { ...pull, commentId, body });
      await refreshDetail();
    },
    async resolveThread(threadId, resolved) {
      await rpc.call("resolveThread", { ...pull, threadId, resolved });
      await refreshDetail();
    },
    async dismissFinding(id, dismissed) {
      await rpc.call("dismissFinding", { id, dismissed });
      reloadState();
    },
    composeFromFinding(finding) {
      const file = fileForFinding(finding);
      if (finding.startLine === null || finding.endLine === null || file === undefined) {
        toast.error("This finding has no line range in the diff to comment on.");
        return;
      }
      if (!isCommentable(file.patch, finding.side, finding.startLine, finding.endLine)) {
        toast.error("GitHub only takes review comments inside the diff's hunks, and this finding is outside them.");
        return;
      }
      if (currentFile?.path !== file.path) selectFile(file.path);
      setComposer({
        path: file.path,
        side: finding.side,
        startLine: finding.startLine,
        endLine: finding.endLine,
        draftId: null,
        initialBody: `**${finding.title}**\n\n${finding.body}`.trim(),
      });
    },
    editDraft(draft) {
      setComposer({ ...draft, draftId: draft.id, initialBody: draft.body });
    },
    closeComposer() {
      setComposer(null);
    },
  };

  const toggleViewed = (file: PullFile) => {
    const next = !file.viewed;
    setViewed((previous) => new Map(previous).set(file.path, next));
    rpc.call("setViewed", { ...pull, pullNodeId: detail.nodeId, path: file.path, viewed: next }).catch((error: unknown) => {
      setViewed((previous) => new Map(previous).set(file.path, !next));
      toast.error(errorMessage(error));
    });
  };

  const runReview = () => {
    setRunning(true);
    rpc
      .call("runReview", pull)
      .then((result) => toast.success(result.delivery === "queued" ? "Review queued in the thread" : "Review started in the thread"))
      .catch((error: unknown) => toast.error(errorMessage(error)))
      .finally(() => setRunning(false));
  };

  const submitReview = async (event: ReviewEvent, body: string) => {
    const result = await rpc.call("submitReview", { ...pull, headSha: detail.headSha, event, body });
    toast.success(`Review submitted${result.comments > 0 ? ` with ${result.comments} comment${result.comments === 1 ? "" : "s"}` : ""}`);
    reloadState();
    await refreshDetail();
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey) return;
      if ((event.altKey && event.key === "ArrowLeft") || (event.ctrlKey && event.key === "-")) {
        event.preventDefault();
        back();
      } else if (!event.altKey && !event.ctrlKey && (event.key === "j" || event.key === "k")) {
        stepFile(event.key === "j" ? 1 : -1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [back, stepFile]);

  const scoped = useMemo(() => {
    const path = currentFile?.path;
    const previousPath = currentFile?.previousPath;
    const matches = (candidate: string) => candidate === path || candidate === previousPath;
    return {
      findings: review.findings.filter((finding) => !finding.dismissed && matches(finding.path)),
      drafts: review.drafts.filter((draft) => draft.path === path),
      threads: detail.threads.filter((thread) => thread.path === path),
    };
  }, [currentFile?.path, currentFile?.previousPath, detail.threads, review.drafts, review.findings]);

  const fullFile = currentFile !== null && fullFiles.has(currentFile.path);
  const showFullFile = () => {
    if (currentFile !== null) setFullFiles((previous) => new Set(previous).add(currentFile.path));
  };
  const peekTarget = current?.kind === "peek" ? current.target : null;
  const peekFile =
    peekTarget?.kind === "repo" && peekTarget.sha === detail.headSha ? files.find((file) => file.path === peekTarget.path) : undefined;
  const openUrl = (url: string) => {
    if (!navigate.openUrl(url)) window.open(url, "_blank", "noopener");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Button size="icon" variant="ghost" className="size-8 shrink-0" title="Back to the board" aria-label="Back to the board" onClick={() => navigate.toPluginPanel(BOARD_PANEL)}>
          <Icon name="ArrowLeft" className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {detail.isDraft ? <span className="shrink-0 rounded border border-border px-1 text-[10px] font-medium uppercase text-muted-foreground">Draft</span> : null}
            <h1 className="truncate text-sm font-semibold" title={detail.title}>
              {detail.title}
            </h1>
            <span className="shrink-0 text-sm text-muted-foreground">#{detail.number}</span>
          </div>
          <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <Avatar person={detail.author} />
            <span className="shrink-0">{detail.author.login}</span>
            <span aria-hidden>·</span>
            <Icon name="GitBranch" className="size-3 shrink-0" />
            <span className="truncate font-mono">
              {detail.headRefName} → {detail.baseRefName}
            </span>
            <span aria-hidden>·</span>
            <span className="shrink-0 tabular-nums">
              <span className="text-emerald-600 dark:text-emerald-400">+{detail.additions}</span>{" "}
              <span className="text-red-600 dark:text-red-400">−{detail.deletions}</span>
            </span>
            {review.agent.running ? (
              <span className="inline-flex shrink-0 items-center gap-1 text-sky-600 dark:text-sky-400">
                <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden />
                agent working
              </span>
            ) : null}
            {review.agent.findings > 0 ? (
              <button type="button" className="shrink-0 text-amber-600 underline-offset-2 hover:underline dark:text-amber-400" onClick={() => setTab("findings")}>
                {review.agent.findings} findings
              </button>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <ToolbarToggle pressed={showDescription} label="Description" icon="AlignLeft" onClick={() => setShowDescription(!showDescription)} />
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={review.agent.threadId === null} onClick={() => review.agent.threadId !== null && navigate.toThread(review.agent.threadId)}>
            <Icon name="MessageSquare" className="size-3.5" />
            <span className="hidden lg:inline">Thread</span>
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => openUrl(detail.url)}>
            <Icon name="Github" className="size-3.5" />
            <span className="hidden lg:inline">GitHub</span>
          </Button>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={running} onClick={runReview} title="Send /thermo-nuclear-code-quality-review to the review thread">
            <Icon name="Play" className="size-3.5" />
            Run review
          </Button>
          <Button size="sm" className="h-7 px-2.5 text-xs" onClick={() => setSubmitOpen(true)}>
            Submit review
            {review.drafts.length > 0 ? <span className="rounded-full bg-background/25 px-1.5 tabular-nums">{review.drafts.length}</span> : null}
          </Button>
        </div>
      </header>
      {showDescription ? (
        <div className="max-h-[40vh] shrink-0 overflow-y-auto border-b border-border px-5 py-3">
          <Markdown content={detail.body.trim().length === 0 ? "_No description provided._" : detail.body} className="text-sm" />
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        {sidebarOpen ? (
          <aside className="w-72 shrink-0 border-r border-border">
            <Sidebar
              files={files}
              selectedPath={currentFile?.path ?? null}
              findings={review.findings}
              drafts={review.drafts}
              threads={detail.threads}
              tab={tab}
              onTab={setTab}
              onSelectFile={selectFile}
              onToggleViewed={toggleViewed}
              onSelectFinding={selectFinding}
            />
          </aside>
        ) : null}
        <main className="relative flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
            <Button size="icon" variant="ghost" className="size-7" aria-pressed={sidebarOpen} title="Toggle the file list" aria-label="Toggle the file list" onClick={() => setSidebarOpen(!sidebarOpen)}>
              <Icon name="PanelLeft" className="size-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="size-7" disabled={history.length === 0} title="Go back (⌥←)" aria-label="Go back" onClick={back}>
              <Icon name="ArrowLeft" className="size-3.5" />
            </Button>
            <span className="min-w-0 flex-1 truncate px-1 font-mono text-xs" title={currentFile?.path}>
              {currentFile?.path ?? (current?.kind === "peek" ? "Definition" : "")}
            </span>
            <span className="hidden text-[11px] text-muted-foreground xl:inline">⌘-click a symbol to go to its definition · j/k files</span>
            <ToolbarToggle pressed={diffStyle === "split"} label="Split" icon="Columns2" onClick={() => setDiffStyle(diffStyle === "split" ? "unified" : "split")} />
            <ToolbarToggle pressed={wrap} label="Wrap" icon="TextWrap" onClick={() => setWrap(!wrap)} />
            {currentFile !== null ? (
              <>
                <ToolbarToggle
                  pressed={fullFile}
                  label="Full file"
                  icon="Maximize2"
                  onClick={() =>
                    setFullFiles((previous) => {
                      const next = new Set(previous);
                      if (!next.delete(currentFile.path)) next.add(currentFile.path);
                      return next;
                    })
                  }
                />
                <ToolbarToggle pressed={currentFile.viewed} label="Viewed" icon={currentFile.viewed ? "CircleCheck" : "Circle"} onClick={() => toggleViewed(currentFile)} />
              </>
            ) : null}
          </div>
          {picker === null ? null : (
            <DefinitionPicker
              result={picker.result}
              onClose={() => setPicker(null)}
              onPick={(index) => {
                const definition = picker.result.definitions[index];
                if (definition !== undefined) jumpTo(definition, picker.sha);
              }}
            />
          )}
          <div className="min-h-0 flex-1 overflow-auto">
            {current === null ? <p className="p-5 text-sm text-muted-foreground">This pull request has no changed files.</p> : null}
            {current?.kind === "diff" && currentFile !== null ? (
              <DiffPane
                key={currentFile.path}
                detail={detail}
                file={currentFile}
                findings={scoped.findings}
                drafts={scoped.drafts}
                threads={scoped.threads}
                diffStyle={diffStyle}
                wrap={wrap}
                fullFile={fullFile}
                focus={current.focus}
                composer={composer?.path === currentFile.path ? composer : null}
                actions={actions}
                onCompose={setComposer}
                onDefinition={findDefinition}
                onShowFullFile={showFullFile}
              />
            ) : null}
            {current?.kind === "peek" ? (
              <PeekPane
                key={`${current.target.kind}:${current.target.path}`}
                detail={detail}
                target={current.target}
                wrap={wrap}
                canOpenInDiff={peekFile !== undefined}
                onOpenInDiff={() => {
                  if (peekFile !== undefined) goTo({ kind: "diff", path: peekFile.path, focus: { side: "additions", line: current.target.line, endLine: current.target.line, seq: nextSeq() } }, true);
                }}
                onDefinition={findDefinition}
              />
            ) : null}
          </div>
        </main>
      </div>
      <SubmitReviewDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        pendingComments={review.drafts.length}
        isAuthor={detail.author.login === detail.viewer}
        onSubmit={submitReview}
      />
    </div>
  );
}
