import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { VideoSummary, rpcContract } from "../contract";
import type { PullRoute } from "../routes";
import { relativeTime } from "./bits";
import { errorMessage } from "./cache";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

export function VideoDialog({
  pull,
  video,
  headSha,
  open,
  onOpenChange,
}: {
  pull: PullRoute;
  video: VideoSummary | null;
  headSha: string;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open || video === null) return;
    let current = true;
    setHtml(null);
    setError(null);
    rpc.call("video", pull).then(
      (result) => {
        if (current) setHtml(result?.html ?? null);
      },
      (failure: unknown) => {
        if (current) setError(errorMessage(failure));
      },
    );
    return () => {
      current = false;
    };
  }, [open, video?.createdAt, pull.repo, pull.number]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(96vw,1280px)] gap-3 p-4">
        <DialogHeader>
          <DialogTitle>{video?.title ?? "Video"}</DialogTitle>
          {video === null ? null : (
            <DialogDescription>
              {video.scenes} scenes · made {relativeTime(video.createdAt)}
              {video.headSha !== null && video.headSha !== headSha ? " · outdated: the PR has new commits since" : null}
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="aspect-video w-full overflow-hidden rounded-md border border-border bg-black">
          {html === null ? (
            <p className="p-5 text-sm text-muted-foreground">{error ?? "Loading the video…"}</p>
          ) : (
            <iframe title={video?.title ?? "PR video"} srcDoc={html} sandbox="allow-scripts" className="size-full border-0" />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
