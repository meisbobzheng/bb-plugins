import { ThreadChat, useBbNavigate, useRealtime, useRpc, type PluginNavPanelProps, type PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import { UPDATES_CHANNEL } from "../channel";
import type { rpcContract } from "../contract";
import { BOARD_PANEL, parseWorkspacePath, workspacePath, type PullRoute } from "../routes";
import { Button } from "./ui/button";
import { Icon } from "./ui/icon";
import { useCached } from "./cache";

function Hint({ children }: { children: string }) {
  return <p className="p-4 text-sm text-muted-foreground">{children}</p>;
}

function PullThread({ pull }: { pull: PullRoute }) {
  const rpc = useRpc<typeof rpcContract>();
  const state = useCached(`state:${pull.repo}#${pull.number}`, () => rpc.call("reviewState", pull));
  useRealtime(UPDATES_CHANNEL, state.reload);
  const threadId = state.value?.agent.threadId ?? null;
  if (state.value === null) return <Hint>{state.error ?? "Loading the review thread…"}</Hint>;
  if (threadId === null) return <Hint>Starting the review thread…</Hint>;
  return <ThreadChat key={threadId} threadId={threadId} variant="compact" />;
}

export function ReviewThreadTab({ subPath }: PluginNavPanelProps) {
  const pull = parseWorkspacePath(subPath);
  if (pull === null) return <Hint>Open a pull request from the board to see its review thread here.</Hint>;
  return <PullThread key={`${pull.repo}#${pull.number}`} pull={pull} />;
}

export function ThreadDiffButton({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const route = useCached(`pull-for:${threadId}`, () => rpc.call("pullForThread", { threadId })).value;
  if (route === null) return null;
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-7 px-2 text-xs"
      title={`Open the diff of ${route.repo}#${route.number} in PR Board`}
      aria-label={`Open the diff of ${route.repo}#${route.number} in PR Board`}
      onClick={() => navigate.toPluginPanel(BOARD_PANEL, { subPath: workspacePath(route) })}
    >
      <Icon name="FileDiff" className="size-3.5" />
      {isCompactViewport ? null : "Review diff"}
    </Button>
  );
}
