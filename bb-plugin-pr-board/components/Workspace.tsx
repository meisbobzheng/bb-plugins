import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { experimental_useAppPanel, useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type {
  ConversationComment,
  Definition,
  DefinitionResult,
  Draft,
  Finding,
  PullDetail,
  PullFile,
  ReviewEvent,
  ReviewComment,
  ReviewState,
  rpcContract,
} from "../contract";
import type { ChangeHighlight, DiffStyle } from "../highlight";
import { isCommentable } from "../patch";
import { REVIEW_THREAD_TAB, type PullRoute } from "../routes";
import { cn } from "../lib/utils";
import type { Composer, ReviewActions } from "./Annotations";
import { CommentsView, commentCount, isWaitingOnViewer, type CommentActions } from "./Comments";
import { SeverityBadge, ToolbarToggle, lineLabel } from "./bits";
import { errorMessage, useCached } from "./cache";
import { DiffPane, type DefinitionRequest, type DiffFocus } from "./DiffPane";
import { FileList, ViewedBox, type FileCounts } from "./FileList";
import { DefinitionPicker, PeekPane, type PeekTarget } from "./PeekPane";
import { ReviewPanel, findingsInFileOrder, type PanelTab } from "./ReviewPanel";
import { SubmitAddressDialog } from "./SubmitAddress";
import { SubmitReviewDialog } from "./SubmitReview";
import { Button } from "./ui/button";
import { Icon } from "./ui/icon";
import { usePreference } from "./use-preference";
import { useUpdates } from "./use-updates";
import { VideoDialog } from "./VideoDialog";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { useWidth } from "./use-width";

type Location =
  | { kind: "diff"; path: string; focus: DiffFocus | null }
  | { kind: "peek"; target: PeekTarget }
  | { kind: "comments"; commentId: string | null; seq: number };

type DiffStylePreference = DiffStyle | "auto";

const HISTORY_LIMIT = 50;
const NARROW_WIDTH = 900;
const DOCKED_PANEL_WIDTH = 1280;
const SPLIT_MIN_WIDTH = 900;
const DIFF_STYLE_OPTIONS: ReadonlyArray<{ id: DiffStylePreference; label: string; icon: string | null }> = [
  { id: "auto", label: "Auto", icon: null },
  { id: "split", label: "Split", icon: "Columns2" },
  { id: "unified", label: "Unified", icon: "Rows2" },
];
const DIFF_STYLES = DIFF_STYLE_OPTIONS.map((option) => option.id);
const HIGHLIGHT_OPTIONS: ReadonlyArray<{ id: ChangeHighlight; label: string; title: string }> = [
  { id: "words", label: "Words", title: "Highlight only the changed words" },
  { id: "lines", label: "Lines", title: "Highlight whole changed lines" },
];
const HIGHLIGHTS = HIGHLIGHT_OPTIONS.map((option) => option.id);
const lastPaths = new Map<string, string>();

interface Pending {
  of: PullDetail;
  resolved: ReadonlyMap<string, boolean>;
  replies: ReadonlyMap<string, readonly ReviewComment[]>;
  comments: readonly ConversationComment[];
}

function withPending(detail: PullDetail, pending: Pending | null): PullDetail {
  if (pending?.of !== detail) return detail;
  return {
    ...detail,
    threads: detail.threads.map((thread) => ({
      ...thread,
      isResolved: pending.resolved.get(thread.id) ?? thread.isResolved,
      comments: [...thread.comments, ...(pending.replies.get(thread.id) ?? [])],
    })),
    conversation: [...detail.conversation, ...pending.comments],
  };
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return counts;
}

function Segmented<T extends string>({
  label,
  options,
  value,
  narrow,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<{ id: T; label: string; title: string; ariaLabel?: string; icon?: string | null }>;
  value: T;
  narrow: boolean;
  onChange(value: T): void;
}) {
  return (
    <div className="flex shrink-0 rounded-md border border-border p-0.5" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          title={option.title}
          aria-label={option.ariaLabel ?? option.title}
          onClick={() => onChange(option.id)}
          className="inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring aria-pressed:bg-state-active aria-pressed:text-foreground"
        >
          {option.icon === undefined || option.icon === null ? null : <Icon name={option.icon} className="size-3.5" aria-hidden />}
          {narrow && option.icon !== undefined && option.icon !== null ? null : option.label}
        </button>
      ))}
    </div>
  );
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
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
  const force = useRef(false);
  const detail = useCached(`detail:${key}`, () => {
    const refresh = force.current;
    force.current = false;
    return rpc.call("pull", { ...pull, refresh });
  });
  const state = useCached(`state:${key}`, () => rpc.call("reviewState", pull));
  useUpdates(pull, state.reload);
  useReviewThread(pull, state.reload);
  const refreshDetail = useCallback(() => {
    force.current = true;
    detail.reload();
  }, [detail.reload]);

  if (detail.value === null) {
    return detail.error === null ? (
      <p className="p-5 text-sm text-muted-foreground">Loading {key}…</p>
    ) : (
      <div className="space-y-3 p-5 text-sm">
        <p className="text-destructive">{detail.error}</p>
        <Button size="sm" variant="outline" onClick={detail.reload}>
          Retry
        </Button>
      </div>
    );
  }
  return (
    <Workspace
      key={key}
      detail={detail.value}
      refreshing={detail.refreshing}
      error={detail.error ?? state.error}
      state={state.value}
      reloadState={state.reload}
      refreshDetail={refreshDetail}
    />
  );
}

const EMPTY_STATE: ReviewState = {
  agent: { threadId: null, running: false, findings: 0 },
  findings: [],
  drafts: [],
  addressAgent: { threadId: null, running: false },
  suggestions: [],
  video: null,
};

function Workspace({
  detail,
  refreshing,
  error,
  state,
  reloadState,
  refreshDetail,
}: {
  detail: PullDetail;
  refreshing: boolean;
  error: string | null;
  state: ReviewState | null;
  reloadState(): void;
  refreshDetail(): void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const appPanel = experimental_useAppPanel();
  const pull = { repo: detail.repo, number: detail.number };
  const review = state ?? EMPTY_STATE;
  const pullKey = `${detail.repo}#${detail.number}`;
  const [rootRef, width] = useWidth<HTMLDivElement>();
  const [mainRef, mainWidth] = useWidth<HTMLElement>();
  const narrow = width !== null && width < NARROW_WIDTH;
  const canDock = width === null || width >= DOCKED_PANEL_WIDTH;
  const [diffStylePreference, setDiffStylePreference] = usePreference<DiffStylePreference>("diff-style", "auto", DIFF_STYLES);
  const diffStyle: DiffStyle =
    diffStylePreference === "auto" ? (mainWidth !== null && mainWidth < SPLIT_MIN_WIDTH ? "unified" : "split") : diffStylePreference;
  const [highlight, setHighlight] = usePreference<ChangeHighlight>("change-highlight", "words", HIGHLIGHTS);
  const [wrap, setWrap] = usePreference<boolean>("wrap", false);
  const [sidebarOpen, setSidebarOpen] = usePreference<boolean>("sidebar", true);
  const [filesPanelOpen, setFilesPanelOpen] = usePreference<boolean>("files-panel", false);
  const filesOpen = narrow ? filesPanelOpen : sidebarOpen;
  const setFilesOpen = narrow ? setFilesPanelOpen : setSidebarOpen;
  const [panelPinned, setPanelPinned] = usePreference<boolean>("review-panel", true);
  const docked = canDock && panelPinned;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tab, setTab] = useState<PanelTab>("findings");
  const [focusedFindingId, setFocusedFindingId] = useState<string | null>(null);
  const [location, setLocation] = useState<Location | null>(() => {
    const path = lastPaths.get(pullKey);
    return path !== undefined && detail.files.some((file) => file.path === path) ? { kind: "diff", path, focus: null } : null;
  });
  const [history, setHistory] = useState<Location[]>([]);
  const [fullFiles, setFullFiles] = useState<ReadonlySet<string>>(new Set());
  const [composer, setComposer] = useState<Composer | null>(null);
  const [picker, setPicker] = useState<{ result: DefinitionResult; sha: string } | null>(null);
  const [viewed, setViewed] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [pending, setPending] = useState<Pending | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitAddressOpen, setSubmitAddressOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  const [addressing, setAddressing] = useState(false);
  const seq = useRef(0);
  const nextSeq = () => ++seq.current;

  const files = useMemo(
    () => detail.files.map((file) => ({ ...file, viewed: viewed.get(file.path) ?? file.viewed })),
    [detail.files, viewed],
  );
  const shown = useMemo(() => withPending(detail, pending), [detail, pending]);
  const addPending = (change: (base: Pending) => Pending) =>
    setPending((previous) => change(previous?.of === detail ? previous : { of: detail, resolved: new Map(), replies: new Map(), comments: [] }));
  const mine = (body: string) => ({
    id: `pending:${nextSeq()}`,
    author: { login: detail.viewer, avatarUrl: null },
    isBot: false,
    body,
    createdAt: new Date().toISOString(),
    url: detail.url,
  });
  const firstPath = files[0]?.path;
  const current = useMemo(
    (): Location | null => location ?? (firstPath === undefined ? null : { kind: "diff", path: firstPath, focus: null }),
    [firstPath, location],
  );
  const currentFile = current?.kind === "diff" ? (files.find((file) => file.path === current.path) ?? null) : null;
  const currentIndex = currentFile === null ? -1 : files.indexOf(currentFile);
  const [commentsVisited, setCommentsVisited] = useState(false);
  useEffect(() => {
    if (current?.kind === "comments") setCommentsVisited(true);
  }, [current?.kind]);
  useEffect(() => {
    if (currentFile !== null) lastPaths.set(pullKey, currentFile.path);
  }, [currentFile?.path, pullKey]);

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
    if (last.kind === "comments") setTab("comments");
    setPicker(null);
  }, [history]);

  const selectFile = useCallback(
    (path: string) => {
      setFocusedFindingId(null);
      goTo({ kind: "diff", path, focus: null }, false);
    },
    [goTo],
  );
  const showPanel = (next: PanelTab) => {
    changeTab(next);
    if (docked) return;
    if (canDock) setPanelPinned(true);
    else setDrawerOpen(true);
  };
  const changeTab = (next: PanelTab) => {
    setTab(next);
    if (next === "comments") {
      if (current?.kind !== "comments") goTo({ kind: "comments", commentId: null, seq: nextSeq() }, true);
    } else if (current?.kind === "comments") {
      const last = lastPaths.get(pullKey);
      const path = last !== undefined && files.some((file) => file.path === last) ? last : firstPath;
      if (path !== undefined) goTo({ kind: "diff", path, focus: null }, false);
    }
  };
  const showComments = () => {
    setTab("comments");
    if (!docked) setDrawerOpen(true);
    setLocation((previous) => (previous?.kind === "comments" ? previous : { kind: "comments", commentId: null, seq: nextSeq() }));
  };
  const selectComment = (commentId: string) => goTo({ kind: "comments", commentId, seq: nextSeq() }, current?.kind !== "comments");
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

  const selectFinding = (finding: Finding, remember = true) => {
    setFocusedFindingId(finding.id);
    const file = fileForFinding(finding);
    if (file === undefined) {
      goTo({ kind: "peek", target: { kind: "repo", sha: detail.headSha, path: finding.path, line: finding.startLine ?? 1, seq: nextSeq() } }, remember);
      return;
    }
    const focus =
      finding.startLine === null || finding.endLine === null
        ? null
        : { side: finding.side, line: finding.startLine, endLine: finding.endLine, seq: nextSeq() };
    goTo({ kind: "diff", path: file.path, focus }, remember);
  };

  const orderedFindings = useMemo(() => findingsInFileOrder(files, review.findings.filter((finding) => !finding.dismissed)), [files, review.findings]);
  const focusedIndex = orderedFindings.findIndex((finding) => finding.id === focusedFindingId);
  const stepFinding = (delta: number) => {
    const fromHere = () => {
      const after = orderedFindings.findIndex((finding) => {
        const file = fileForFinding(finding);
        return file === undefined || files.indexOf(file) >= Math.max(currentIndex, 0);
      });
      return delta > 0 ? Math.max(after, 0) : (after < 0 ? orderedFindings.length : after) - 1;
    };
    const next = orderedFindings[focusedIndex < 0 ? fromHere() : focusedIndex + delta];
    if (next !== undefined) selectFinding(next, false);
  };

  const selectDraft = (draft: Draft) =>
    goTo({ kind: "diff", path: draft.path, focus: { side: draft.side, line: draft.startLine, endLine: draft.endLine, seq: nextSeq() } }, true);

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
      const draft = review.drafts.find((candidate) => candidate.id === id);
      await rpc.call("deleteDraft", { id });
      reloadState();
      if (draft === undefined) return;
      toast("Deleted the pending comment", {
        action: {
          label: "Undo",
          onClick: () => {
            rpc.call("saveDraft", { ...pull, ...draft, id: null }).then(reloadState, (error: unknown) => toast.error(errorMessage(error)));
          },
        },
      });
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
      refreshDetail();
    },
    async askAgent(target, question) {
      await rpc.call("askAgent", {
        ...pull,
        path: target.path,
        side: target.side,
        startLine: target.startLine,
        endLine: target.endLine,
        question,
      });
      setComposer(null);
      appPanel.openFixedTab({ surface: { kind: "current" }, tab: REVIEW_THREAD_TAB });
      toast.success("Asked the review thread");
    },
    async reply(commentId, body) {
      await rpc.call("reply", { ...pull, commentId, body });
      const thread = detail.threads.find((candidate) => candidate.comments[0]?.databaseId === commentId);
      if (thread !== undefined) {
        const reply = { ...mine(body), databaseId: 0 };
        addPending((base) => ({ ...base, replies: new Map(base.replies).set(thread.id, [...(base.replies.get(thread.id) ?? []), reply]) }));
      }
      refreshDetail();
    },
    async resolveThread(threadId, resolved) {
      await rpc.call("resolveThread", { ...pull, threadId, resolved });
      addPending((base) => ({ ...base, resolved: new Map(base.resolved).set(threadId, resolved) }));
      refreshDetail();
    },
    async dismissFinding(id, dismissed) {
      await rpc.call("dismissFindings", { ids: [id], dismissed });
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

  const explain = () => {
    setExplaining(true);
    rpc
      .call("explainPull", pull)
      .then((result) =>
        toast.success(
          result.delivery === "queued"
            ? "Video queued in the review thread. Video appears in the header when it is ready."
            : "Asked the review thread for a video. Video appears in the header when it is ready.",
        ),
      )
      .catch((error: unknown) => toast.error(errorMessage(error)))
      .finally(() => setExplaining(false));
  };

  const addressComments = () => {
    const starting = review.addressAgent.threadId === null;
    setAddressing(true);
    rpc
      .call("addressComments", pull)
      .then(() => {
        toast.success(
          starting
            ? "Started a thread that suggests changes and replies for the comments. Nothing changes until you accept a suggestion."
            : "Asked the address thread to suggest changes and replies again",
        );
        showComments();
        reloadState();
        refreshDetail();
      })
      .catch((error: unknown) => toast.error(errorMessage(error)))
      .finally(() => setAddressing(false));
  };

  const commentActions: CommentActions = {
    reply: actions.reply,
    resolveThread: actions.resolveThread,
    async postConversation(body) {
      await rpc.call("postConversationComment", { ...pull, body });
      const comment = { ...mine(body), kind: "comment" as const };
      addPending((base) => ({ ...base, comments: [...base.comments, comment] }));
      toast.success("Comment posted");
      refreshDetail();
    },
    async applySuggestion(id) {
      await rpc.call("applySuggestion", { id });
      toast.success("Applied the change to the address thread's worktree. It is not committed.");
      reloadState();
    },
    async setReplyState(id, state) {
      await rpc.call("setSuggestionState", { id, part: "reply", state });
      reloadState();
    },
    async setChangeState(id, state) {
      await rpc.call("setSuggestionState", { id, part: "change", state });
      reloadState();
    },
    viewInDiff(thread) {
      const file = files.find((candidate) => candidate.path === thread.path || candidate.previousPath === thread.path);
      if (file === undefined) {
        toast.error("This comment's file is not part of the diff anymore.");
        return;
      }
      const focus =
        thread.line === null ? null : { side: thread.side, line: thread.startLine ?? thread.line, endLine: thread.line, seq: nextSeq() };
      goTo({ kind: "diff", path: file.path, focus }, true);
    },
    openThread(threadId) {
      navigate.toThread(threadId);
    },
  };

  const submitAddress = async () => {
    await rpc.call("submitAddress", pull);
    toast.success(`Sent to the address thread: it runs the checks, then commits and pushes to ${detail.headRefName} if they pass.`);
    reloadState();
  };

  const dismissAllFindings = () => {
    const ids = review.findings.filter((finding) => !finding.dismissed).map((finding) => finding.id);
    const setDismissed = (dismissed: boolean) => rpc.call("dismissFindings", { ids, dismissed }).then(reloadState);
    setDismissed(true).then(
      () =>
        toast(`Dismissed ${ids.length} finding${ids.length === 1 ? "" : "s"}`, {
          action: { label: "Undo", onClick: () => void setDismissed(false).catch((error: unknown) => toast.error(errorMessage(error))) },
        }),
      (error: unknown) => toast.error(errorMessage(error)),
    );
  };

  const submitReview = async (event: ReviewEvent, body: string) => {
    const result = await rpc.call("submitReview", { ...pull, headSha: detail.headSha, event, body });
    toast.success(`Review submitted${result.comments > 0 ? ` with ${result.comments} comment${result.comments === 1 ? "" : "s"}` : ""}`);
    reloadState();
    refreshDetail();
  };

  const viewedAndNext = () => {
    if (currentFile === null) return;
    if (!currentFile.viewed) toggleViewed(currentFile);
    const next = [...files.slice(currentIndex + 1), ...files.slice(0, currentIndex)].find((file) => !file.viewed);
    if (next === undefined) toast.success("Every file is viewed.");
    else selectFile(next.path);
  };

  const onKey = useRef<(event: KeyboardEvent) => void>(() => {});
  onKey.current = (event) => {
    if (isTyping(event.target) || event.metaKey) return;
    if ((event.altKey && event.key === "ArrowLeft") || (event.ctrlKey && event.key === "-")) {
      event.preventDefault();
      back();
      return;
    }
    if (event.altKey || event.ctrlKey) return;
    if (event.key === "Escape" && drawerOpen) setDrawerOpen(false);
    else if (event.key === "n" || event.key === "p") stepFinding(event.key === "n" ? 1 : -1);
    else if (current?.kind === "comments") return;
    else if (event.key === "j" || event.key === "k") stepFile(event.key === "j" ? 1 : -1);
    else if (event.key === "v") viewedAndNext();
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey.current(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const scoped = useMemo(() => {
    const path = currentFile?.path;
    const previousPath = currentFile?.previousPath;
    const matches = (candidate: string) => candidate === path || candidate === previousPath;
    return {
      findings: review.findings.filter((finding) => !finding.dismissed && matches(finding.path)),
      drafts: review.drafts.filter((draft) => draft.path === path),
      threads: shown.threads.filter((thread) => thread.path === path),
    };
  }, [currentFile?.path, currentFile?.previousPath, shown.threads, review.drafts, review.findings]);

  const fileCounts = useMemo((): FileCounts => {
    const pathOf = (finding: Finding) => files.find((file) => file.path === finding.path || file.previousPath === finding.path)?.path ?? finding.path;
    const unresolved = shown.threads.filter((thread) => !thread.isResolved);
    return {
      findings: countBy(orderedFindings, pathOf),
      waiting: countBy(
        unresolved.filter((thread) => isWaitingOnViewer(thread, detail.viewer)),
        (thread) => thread.path,
      ),
      threads: countBy(
        unresolved.filter((thread) => !isWaitingOnViewer(thread, detail.viewer)),
        (thread) => thread.path,
      ),
      drafts: countBy(review.drafts, (draft) => draft.path),
    };
  }, [detail.viewer, files, orderedFindings, review.drafts, shown.threads]);

  const findingsHere = currentFile === null ? [] : orderedFindings.filter((finding) => fileForFinding(finding) === currentFile);
  const waitingHere = scoped.threads.filter((thread) => isWaitingOnViewer(thread, detail.viewer));
  const waitingCount = shown.threads.filter((thread) => isWaitingOnViewer(thread, detail.viewer)).length + detail.awaitingReply.length;
  const fullFile = currentFile !== null && fullFiles.has(currentFile.path);
  const showFullFile = () => {
    if (currentFile !== null) setFullFiles((previous) => new Set(previous).add(currentFile.path));
  };
  const peekTarget = current?.kind === "peek" ? current.target : null;
  const peekFile =
    peekTarget?.kind === "repo" && peekTarget.sha === detail.headSha ? files.find((file) => file.path === peekTarget.path) : undefined;
  const fileList = (
    <FileList files={files} selectedPath={currentFile?.path ?? null} counts={fileCounts} onSelectFile={selectFile} onToggleViewed={toggleViewed} />
  );
  const panel = (
    <ReviewPanel
      detail={shown}
      files={files}
      review={review}
      tab={tab}
      focusedFindingId={focusedFindingId}
      selectedCommentId={current?.kind === "comments" ? current.commentId : null}
      onTab={changeTab}
      onClose={docked ? null : () => setDrawerOpen(false)}
      onSelectFinding={(finding) => selectFinding(finding)}
      onSelectDraft={selectDraft}
      onDismissAllFindings={dismissAllFindings}
      onSelectComment={selectComment}
      onOpenThread={(threadId) => navigate.toThread(threadId)}
    />
  );
  const railItems: ReadonlyArray<{ id: PanelTab; icon: string; label: string; count: number; tone: string }> = [
    { id: "findings", icon: "Bot", label: "Findings", count: orderedFindings.length, tone: "bg-warning/30 text-warning-text" },
    { id: "overview", icon: "AlignLeft", label: "Overview", count: 0, tone: "" },
    { id: "comments", icon: "MessageSquare", label: "Comments", count: waitingCount, tone: "bg-destructive/20 text-destructive-text" },
  ];
  const diffStyleOptions = DIFF_STYLE_OPTIONS.map((option) => ({
    ...option,
    label: option.id === "auto" && diffStylePreference === "auto" ? `Auto (${diffStyle})` : option.label,
    title: option.id === "auto" ? `Auto: split when the diff is at least ${SPLIT_MIN_WIDTH}px wide` : option.label,
    ariaLabel: `${option.label} diff`,
  }));

  return (
    <div ref={rootRef} data-vim-defer="j k n p v" className="flex h-full min-h-0 flex-col">
      <WorkspaceHeader
        detail={detail}
        review={review}
        narrow={narrow}
        refreshing={refreshing}
        error={error}
        running={running}
        explaining={explaining}
        addressing={addressing}
        onRefresh={() => {
          refreshDetail();
          reloadState();
        }}
        onShowFindings={() => showPanel("findings")}
        onRunReview={runReview}
        onExplain={explain}
        onWatchVideo={() => setVideoOpen(true)}
        onAddressComments={addressComments}
        submittingAddress={submitAddressOpen}
        onSubmitAddress={() => setSubmitAddressOpen(true)}
        onSubmit={() => setSubmitOpen(true)}
      />
      <div className={cn("relative flex min-h-0 flex-1", narrow && "flex-col")}>
        {filesOpen ? (
          narrow ? (
            <section className="h-[32vh] min-h-48 shrink-0 border-b border-border" aria-label="Files">
              {fileList}
            </section>
          ) : (
            <aside className="w-64 shrink-0 border-r border-border bg-card">{fileList}</aside>
          )
        ) : null}
        <main ref={mainRef} className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border bg-card px-2 py-1">
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              aria-pressed={filesOpen}
              title="Toggle the file list"
              aria-label="Toggle the file list"
              onClick={() => setFilesOpen(!filesOpen)}
            >
              <Icon name={narrow ? "ListView" : "PanelLeft"} fallback="PanelLeft" className="size-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="size-7" disabled={history.length === 0} title="Go back (⌥←)" aria-label="Go back" onClick={back}>
              <Icon name="ArrowLeft" className="size-3.5" />
            </Button>
            <span className="min-w-0 flex-1 basis-40 truncate px-1 font-mono text-xs" title={currentFile?.path}>
              {currentFile === null
                ? current?.kind === "peek"
                  ? "Definition"
                  : current?.kind === "comments"
                    ? "Comments"
                    : ""
                : `${currentIndex + 1}/${files.length}  ${currentFile.path}`}
            </span>
            {narrow ? null : <span className="hidden text-[11px] text-muted-foreground 2xl:inline">⌘-click a symbol to go to its definition</span>}
            <Segmented label="Diff layout" options={diffStyleOptions} value={diffStylePreference} narrow={narrow} onChange={setDiffStylePreference} />
            <Segmented label="Change highlight" options={HIGHLIGHT_OPTIONS} value={highlight} narrow={false} onChange={setHighlight} />
            <ToolbarToggle
              pressed={wrap || diffStyle === "split"}
              label="Wrap"
              title={diffStyle === "split" ? "Split always wraps, so both sides stay lined up" : "Wrap long lines"}
              icon="TextWrap"
              showLabel={!narrow}
              disabled={diffStyle === "split"}
              onClick={() => setWrap(!wrap)}
            />
            {currentFile !== null ? (
              <>
                <ToolbarToggle
                  pressed={fullFile}
                  label="Full file"
                  icon="Maximize2"
                  showLabel={!narrow}
                  onClick={() =>
                    setFullFiles((previous) => {
                      const next = new Set(previous);
                      if (!next.delete(currentFile.path)) next.add(currentFile.path);
                      return next;
                    })
                  }
                />
                <Button
                  size="sm"
                  variant="outline"
                  aria-pressed={currentFile.viewed}
                  aria-label="Viewed"
                  title={currentFile.viewed ? "You viewed this file. Click to mark it not viewed." : "Mark this file viewed"}
                  className={cn("h-7 shrink-0 px-2 text-xs", currentFile.viewed && "border-success/50 bg-success/10 text-success")}
                  onClick={() => toggleViewed(currentFile)}
                >
                  <ViewedBox viewed={currentFile.viewed} />
                  {narrow ? null : currentFile.viewed ? "Viewed" : "Mark viewed"}
                </Button>
              </>
            ) : null}
            {canDock ? (
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                aria-pressed={panelPinned}
                title="Toggle the review panel"
                aria-label="Toggle the review panel"
                onClick={() => setPanelPinned(!panelPinned)}
              >
                <Icon name="PanelLeft" className="size-3.5 rotate-180" />
              </Button>
            ) : null}
          </div>
          {current?.kind === "diff" && (findingsHere.length > 0 || waitingHere.length > 0 || orderedFindings.length > 0) ? (
            <div className="flex shrink-0 items-center gap-1.5 border-b border-border bg-warning/5 px-2 py-1 text-xs" role="group" aria-label="In this file">
              <span className="shrink-0 font-medium">{findingsHere.length + waitingHere.length === 0 ? "Nothing flagged in this file" : "In this file"}</span>
              <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
                {findingsHere.map((finding) => (
                  <button
                    key={finding.id}
                    type="button"
                    aria-pressed={finding.id === focusedFindingId}
                    title={`${finding.title} (${lineLabel(finding.startLine, finding.endLine)})`}
                    onClick={() => selectFinding(finding, false)}
                    className="inline-flex max-w-64 shrink-0 items-center gap-1 rounded-full border border-border bg-background py-0.5 pl-0.5 pr-2 outline-none hover:border-ring/60 focus-visible:ring-1 focus-visible:ring-ring aria-pressed:border-ring aria-pressed:ring-1 aria-pressed:ring-ring"
                  >
                    <SeverityBadge severity={finding.severity} />
                    <span className="truncate">{finding.title}</span>
                  </button>
                ))}
                {waitingHere.map((thread) => (
                  <button
                    key={thread.id}
                    type="button"
                    title="Waiting for your reply"
                    onClick={() => commentActions.viewInDiff(thread)}
                    className="inline-flex max-w-64 shrink-0 items-center gap-1 rounded-full border border-border bg-background py-0.5 pl-0.5 pr-2 outline-none hover:border-ring/60 focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <span className="rounded-full bg-destructive/15 px-1.5 text-[10px] font-semibold text-destructive-text">reply</span>
                    <span className="truncate">
                      {thread.comments.at(-1)?.author.login} on {thread.line === null ? "this file" : `line ${thread.line}`}
                    </span>
                  </button>
                ))}
              </div>
              {orderedFindings.length === 0 ? null : (
                <span className="flex shrink-0 items-center gap-0.5 text-muted-foreground">
                  <Button size="icon" variant="ghost" className="size-6" title="Previous finding (p)" aria-label="Previous finding" onClick={() => stepFinding(-1)}>
                    <Icon name="ChevronLeft" fallback="ArrowLeft" className="size-3.5" />
                  </Button>
                  <span className="tabular-nums" aria-label="Finding position">
                    {focusedIndex < 0 ? "–" : focusedIndex + 1}/{orderedFindings.length}
                  </span>
                  <Button size="icon" variant="ghost" className="size-6" title="Next finding (n)" aria-label="Next finding" onClick={() => stepFinding(1)}>
                    <Icon name="ChevronRight" className="size-3.5" />
                  </Button>
                </span>
              )}
            </div>
          ) : null}
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
          <div data-scroll-root className="min-h-0 flex-1 overflow-auto">
            {current === null ? <p className="p-5 text-sm text-muted-foreground">This pull request has no changed files.</p> : null}
            {current?.kind === "diff" && currentFile !== null ? (
              <DiffPane
                key={currentFile.path}
                detail={detail}
                file={currentFile}
                next={files[currentIndex + 1]}
                findings={scoped.findings}
                drafts={scoped.drafts}
                threads={scoped.threads}
                diffStyle={diffStyle}
                highlight={highlight}
                wrap={wrap}
                fullFile={fullFile}
                focus={current.focus}
                focusedFindingId={focusedFindingId}
                composer={composer?.path === currentFile.path ? composer : null}
                actions={actions}
                onCompose={setComposer}
                onDefinition={findDefinition}
                onShowFullFile={showFullFile}
              />
            ) : null}
            {commentsVisited ? (
              <div className={current?.kind === "comments" ? undefined : "hidden"}>
                <CommentsView
                  detail={shown}
                  review={review}
                  focus={current?.kind === "comments" && current.commentId !== null ? { commentId: current.commentId, seq: current.seq } : null}
                  actions={commentActions}
                />
              </div>
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
          {current?.kind === "diff" && currentFile !== null ? (
            <div className="flex shrink-0 items-center gap-1 border-t border-border bg-card px-2 py-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                disabled={currentIndex <= 0}
                title="Previous file (k)"
                aria-label="Previous file"
                onClick={() => stepFile(-1)}
              >
                <Icon name="ArrowUp" className="size-3.5" />
                {narrow ? null : "Previous"}
              </Button>
              <span className="min-w-0 flex-1 truncate text-center text-xs text-muted-foreground">
                {currentFile.viewed ? (
                  <span className="text-success">You viewed this file</span>
                ) : findingsHere.length > 0 ? (
                  `${findingsHere.length} finding${findingsHere.length === 1 ? "" : "s"} here · not viewed yet`
                ) : (
                  "Not viewed yet"
                )}
              </span>
              <Button size="sm" className="h-7 px-2.5 text-xs" title="Mark this file viewed and open the next one you haven't viewed (v)" onClick={viewedAndNext}>
                <Icon name="Check" className="size-3.5" />
                Viewed · next unviewed
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                disabled={currentIndex < 0 || currentIndex >= files.length - 1}
                title="Next file (j)"
                aria-label="Next file"
                onClick={() => stepFile(1)}
              >
                {narrow ? null : "Next"}
                <Icon name="ArrowDown" className="size-3.5" />
              </Button>
            </div>
          ) : null}
        </main>
        {docked ? (
          <aside className="w-80 shrink-0 border-l border-border bg-card xl:w-96" aria-label="Review panel">
            {panel}
          </aside>
        ) : (
          <>
            {drawerOpen ? (
              <aside
                className={cn(
                  "absolute z-20 border-border bg-card shadow-lg",
                  narrow ? "inset-x-0 bottom-10 top-0 border-b" : "inset-y-0 right-10 w-[min(24rem,calc(100%-3rem))] border-l",
                )}
                aria-label="Review panel"
              >
                {panel}
              </aside>
            ) : null}
            <nav className={cn("flex shrink-0 items-center gap-1 border-border bg-card", narrow ? "border-t px-2 py-1" : "w-10 flex-col border-l py-2")} aria-label="Review panel tabs">
              {railItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={drawerOpen && tab === item.id}
                  title={item.label}
                  aria-label={item.label}
                  onClick={() => {
                    if (drawerOpen && tab === item.id) setDrawerOpen(false);
                    else {
                      changeTab(item.id);
                      setDrawerOpen(true);
                    }
                  }}
                  className="relative flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-state-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring aria-pressed:bg-state-active aria-pressed:text-foreground"
                >
                  <Icon name={item.icon} className="size-4" />
                  {item.count > 0 ? (
                    <span className={cn("absolute -right-0.5 -top-0.5 min-w-3.5 rounded-full px-0.5 text-[9px] font-bold leading-[14px] tabular-nums", item.tone)}>
                      {item.count}
                    </span>
                  ) : null}
                </button>
              ))}
            </nav>
          </>
        )}
      </div>
      <SubmitReviewDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        pendingComments={review.drafts.length}
        unviewed={files.filter((file) => !file.viewed).map((file) => file.path)}
        isAuthor={detail.author.login === detail.viewer}
        onSubmit={submitReview}
        onReviewUnviewed={(path) => {
          setSubmitOpen(false);
          selectFile(path);
        }}
      />
      <VideoDialog pull={pull} video={review.video} headSha={detail.headSha} open={videoOpen} onOpenChange={setVideoOpen} />
      <SubmitAddressDialog
        open={submitAddressOpen}
        onOpenChange={setSubmitAddressOpen}
        branch={detail.headRefName}
        acceptedChanges={review.suggestions.filter((suggestion) => suggestion.changeState === "applied").length}
        onSubmit={submitAddress}
      />
    </div>
  );
}
