import { useEffect, useMemo, useRef } from "react";
import { File, type FileProps } from "@pierre/diffs/react";
import { experimental_useCodeTheme, useRpc } from "@get-bb/plugin-sdk/app";
import type { DefinitionResult, PullDetail, rpcContract } from "../contract";
import { identifierAt, isModifierClick, useModifierUnderline, useScrollToLine } from "./code";
import type { DefinitionRequest } from "./DiffPane";
import { Button } from "./ui/button";
import { Icon } from "./ui/icon";
import { useLoad } from "./use-load";

export type PeekTarget =
  | { kind: "repo"; sha: string; path: string; line: number; seq: number }
  | { kind: "external"; path: string; line: number; seq: number };

const UNAVAILABLE = { missing: "This file does not exist at that commit.", binary: "This is a binary file.", "too-large": "This file is too large to show." };

export function PeekPane({
  detail,
  target,
  wrap,
  canOpenInDiff,
  onOpenInDiff,
  onDefinition,
}: {
  detail: PullDetail;
  target: PeekTarget;
  wrap: boolean;
  canOpenInDiff: boolean;
  onOpenInDiff(): void;
  onDefinition(request: DefinitionRequest): void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const codeTheme = experimental_useCodeTheme();
  const host = useRef<HTMLDivElement>(null);
  const underline = useModifierUnderline();
  const key = target.kind === "repo" ? `${target.sha}:${target.path}` : target.path;
  const [content] = useLoad(key, () =>
    target.kind === "repo"
      ? rpc.call("fileAt", { repo: detail.repo, sha: target.sha, path: target.path })
      : rpc.call("externalFile", { path: target.path }),
  );

  const onToken = useRef<(props: TokenProps, event: MouseEvent) => void>(() => {});
  onToken.current = (props, event) => {
    if (target.kind !== "repo" || !isModifierClick(event)) return;
    const identifier = identifierAt(props.tokenElement, props.tokenText, event.clientX);
    if (identifier === null) return;
    event.preventDefault();
    onDefinition({
      sha: target.sha,
      path: target.path,
      line: props.lineNumber,
      character: props.lineCharStart + identifier.offset,
      symbol: identifier.text,
    });
  };

  const options = useMemo(
    (): NonNullable<FileProps<undefined>["options"]> => ({
      theme: codeTheme.name,
      themeType: codeTheme.mode,
      overflow: wrap ? "wrap" : "scroll",
      disableFileHeader: true,
      useTokenTransformer: true,
      lineHoverHighlight: "both",
      onTokenClick: (props, event) => onToken.current(props, event),
      onTokenEnter: (props, event) => underline.enter(props.tokenElement, isModifierClick(event)),
      onTokenLeave: (props) => underline.leave(props.tokenElement),
    }),
    [codeTheme.mode, codeTheme.name, underline, wrap],
  );
  const focus = useMemo(() => ({ side: null, line: target.line, seq: target.seq }), [target.line, target.seq]);
  const selectedLines = useMemo(() => ({ start: target.line, end: target.line }), [target.line]);
  useScrollToLine(host, focus, key, null, () => {});

  const label = target.kind === "external" ? "outside the repository" : target.sha === detail.headSha ? "PR head" : "merge base";
  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background/95 px-3 py-1.5 text-xs backdrop-blur">
        <Icon name="Code" className="size-3.5 text-muted-foreground" />
        <span className="min-w-0 truncate font-mono">
          {target.path}:{target.line}
        </span>
        <span className="shrink-0 rounded border border-border px-1 text-[10px] text-muted-foreground">{label}</span>
        <span className="flex-1" />
        {canOpenInDiff ? (
          <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={onOpenInDiff}>
            <Icon name="FileDiff" className="size-3" />
            Open in diff
          </Button>
        ) : null}
      </div>
      <div ref={host} className="pb-24">
        {content.status === "loading" ? <p className="p-4 text-sm text-muted-foreground">Loading…</p> : null}
        {content.status === "error" ? <p className="p-4 text-sm text-destructive">{content.message}</p> : null}
        {content.status === "ready" && content.value.content === null ? (
          <p className="p-4 text-sm text-muted-foreground">{UNAVAILABLE[content.value.unavailable ?? "missing"]}</p>
        ) : null}
        {content.status === "ready" && content.value.content !== null ? (
          <File
            file={{ name: target.path, contents: content.value.content, cacheKey: `peek:${key}` }}
            options={options}
            selectedLines={selectedLines}
            disableWorkerPool
          />
        ) : null}
      </div>
    </div>
  );
}

type TokenProps = Parameters<NonNullable<NonNullable<FileProps<undefined>["options"]>["onTokenClick"]>>[0];

export function DefinitionPicker({
  result,
  onPick,
  onClose,
}: {
  result: DefinitionResult;
  onPick(index: number): void;
  onClose(): void;
}) {
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    list.current?.querySelector("button")?.focus();
  }, [result]);
  return (
    <div
      className="absolute inset-x-3 top-3 z-20 max-h-[60%] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
      role="dialog"
      aria-label={`Definitions of ${result.symbol}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const buttons = [...(list.current?.querySelectorAll("button") ?? [])];
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          buttons[(index + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length]?.focus();
        }
      }}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs">
        <span>
          {result.definitions.length} definitions of <code className="font-mono font-semibold">{result.symbol}</code>
        </span>
        <span className="flex-1" />
        <button type="button" className="rounded p-0.5 text-muted-foreground hover:bg-state-hover" aria-label="Close" onClick={onClose}>
          <Icon name="X" className="size-3.5" />
        </button>
      </div>
      <ul ref={list} className="max-h-80 overflow-y-auto py-1">
        {result.definitions.map((definition, index) => (
          <li key={`${definition.path}:${definition.line}`}>
            <button
              type="button"
              onClick={() => onPick(index)}
              className="block w-full px-3 py-1.5 text-left outline-none hover:bg-state-hover focus-visible:bg-state-hover"
            >
              <span className="block truncate font-mono text-xs">
                {definition.path}:{definition.line}
              </span>
              <span className="block truncate font-mono text-[11px] text-muted-foreground">{definition.preview}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
