import { useState } from "react";
import { toast } from "sonner";
import type { ReviewEvent } from "../contract";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { errorMessage } from "./use-load";

const EVENTS: ReadonlyArray<{ id: ReviewEvent; label: string; hint: string }> = [
  { id: "COMMENT", label: "Comment", hint: "Submit general feedback without explicit approval." },
  { id: "APPROVE", label: "Approve", hint: "Submit feedback and approve merging these changes." },
  { id: "REQUEST_CHANGES", label: "Request changes", hint: "Submit feedback that must be addressed before merging." },
];

export function SubmitReviewDialog({
  open,
  onOpenChange,
  pendingComments,
  isAuthor,
  onSubmit,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  pendingComments: number;
  isAuthor: boolean;
  onSubmit(event: ReviewEvent, body: string): Promise<void>;
}) {
  const [event, setEvent] = useState<ReviewEvent>("COMMENT");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const needsBody = event !== "APPROVE" && pendingComments === 0;
  const submit = () => {
    setSubmitting(true);
    onSubmit(event, body)
      .then(() => {
        setBody("");
        setEvent("COMMENT");
        onOpenChange(false);
      })
      .catch((error: unknown) => toast.error(errorMessage(error)))
      .finally(() => setSubmitting(false));
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Finish your review</DialogTitle>
          <DialogDescription>
            {pendingComments === 0
              ? "No pending comments."
              : `${pendingComments} pending comment${pendingComments === 1 ? "" : "s"} will be posted with this review.`}
          </DialogDescription>
        </DialogHeader>
        <textarea
          autoFocus
          value={body}
          onChange={(change) => setBody(change.target.value)}
          onKeyDown={(key) => {
            if ((key.metaKey || key.ctrlKey) && key.key === "Enter" && !submitting && !(needsBody && body.trim() === "")) submit();
          }}
          rows={6}
          placeholder="Leave a comment"
          aria-label="Review summary"
          className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
        />
        <fieldset className="space-y-1.5">
          <legend className="sr-only">Review type</legend>
          {EVENTS.map((option) => {
            const disabled = isAuthor && option.id !== "COMMENT";
            return (
              <label
                key={option.id}
                className={cn(
                  "flex cursor-pointer items-start gap-2 rounded-md border border-transparent p-2 text-sm hover:bg-state-hover",
                  event === option.id && "border-border bg-state-active",
                  disabled && "cursor-not-allowed opacity-50",
                )}
              >
                <input
                  type="radio"
                  name="review-event"
                  className="mt-1"
                  checked={event === option.id}
                  disabled={disabled}
                  onChange={() => setEvent(option.id)}
                />
                <span>
                  <span className="font-medium">{option.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {disabled ? "GitHub does not let authors approve or request changes on their own pull request." : option.hint}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={submitting || (needsBody && body.trim() === "")} onClick={submit}>
            {submitting ? "Submitting…" : "Submit review"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
