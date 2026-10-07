import { ThreadChat, useBbNavigate, useRealtime, useRpc, type PluginNavPanelProps, type PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import { UPDATES_CHANNEL } from "../channel";
import type { rpcContract } from "../contract";
import { BOARD_PANEL, parseWorkspacePath, workspacePath, type PullRoute } from "../routes";
import { Button } from "./ui/button";
import { Icon } from "./ui/icon";
import { useLoad } from "./use-load";

function Hint({ children }: { children: string }) {
  return <p className="p-4 text-sm text-muted-foreground">{children}</p>;
}

function PullThread({ pull }: { pull: PullRoute }) {
  const rpc = useRpc<typeof rpcContract>();
  const [state, reload] = useLoad(`thread:${pull.repo}#${pull.number}`, () => rpc.call("reviewState", pull));
  useRealtime(UPDATES_CHANNEL, reload);
  if (state.status === "loading") return <Hint>Loading the review thread…</Hint>;
  if (state.status === "error") return <Hint>{state.message}</Hint>;
  if (state.value.agent.threadId === null) return <Hint>Starting the review thread…</Hint>;
  return <ThreadChat key={state.value.agent.threadId} threadId={state.value.agent.threadId} variant="compact" />;
}

export function ReviewThreadTab({ subPath }: PluginNavPanelProps) {
  const pull = parseWorkspacePath(subPath);
  if (pull === null) return <Hint>Open a pull request from the board to see its review thread here.</Hint>;
  return <PullThread key={`${pull.repo}#${pull.number}`} pull={pull} />;
}

export function ThreadDiffButton({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [pull] = useLoad(`pull-for:${threadId}`, () => rpc.call("pullForThread", { threadId }));
  if (pull.status !== "ready" || pull.value === null) return null;
  const route = pull.value;
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
