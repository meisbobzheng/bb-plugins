import { forwardRef, useState, type ComponentProps, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "./ui/icon";
import { cn } from "../lib/utils";
import { KINDS, KIND_LABELS, MARK_END, MARK_START, type Kind } from "../library";
import { normalizeTags, topicFor } from "../topics";

export function KindBadge({ kind, className }: { kind: Kind; className?: string }) {
  return (
    <span className={cn("shrink-0 rounded border border-border px-1.5 py-px text-[11px] leading-4 text-muted-foreground", className)}>
      {KIND_LABELS[kind].one}
    </span>
  );
}

export function tagTooltip(tag: string): string | undefined {
  const topic = topicFor(tag);
  if (topic === undefined) return undefined;
  return topic.specs.length === 0 ? topic.about : `${topic.about} · ${topic.specs.join(", ")}`;
}

interface TagChipProps {
  tag: string;
  count?: number;
  active?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
}

export function TagChip({ tag, count, active = false, onClick, onRemove }: TagChipProps) {
  const chip = cn(
    "inline-flex h-6 max-w-full items-center gap-1 rounded-full border px-2 text-xs transition-colors",
    active ? "border-foreground/40 bg-foreground/10 text-foreground" : "border-border text-muted-foreground",
    onClick !== undefined && "cursor-pointer hover:bg-state-hover hover:text-foreground",
  );
  const label = (
    <>
      <span className="truncate">{tag}</span>
      {count === undefined ? null : <span className="tabular-nums opacity-70">{count}</span>}
    </>
  );
  return (
    <span className={chip} title={tagTooltip(tag)}>
      {onClick === undefined ? (
        label
      ) : (
        <button type="button" className="inline-flex min-w-0 cursor-pointer items-center gap-1" aria-pressed={active} onClick={onClick}>
          {label}
        </button>
      )}
      {onRemove === undefined ? null : (
        <button type="button" className="-mr-1 cursor-pointer rounded-full p-0.5 hover:text-foreground" aria-label={`Remove tag ${tag}`} onClick={onRemove}>
          <Icon name="X" className="size-3" />
        </button>
      )}
    </span>
  );
}

export function Highlighted({ text }: { text: string }) {
  const parts = text.split(MARK_START);
  return (
    <>
      {parts[0]}
      {parts.slice(1).map((part, index) => {
        const [marked = "", rest = ""] = part.split(MARK_END);
        return (
          <span key={index}>
            <mark className="rounded-sm bg-foreground/15 px-0.5 text-foreground">{marked}</mark>
            {rest}
          </span>
        );
      })}
    </>
  );
}

export function EmptyState({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div role="status" className={cn("rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground", className)}>
      {children}
    </div>
  );
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function formatDate(iso: string, now = Date.now()): string {
  const date = new Date(iso);
  const minutes = Math.round((date.getTime() - now) / 60_000);
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 7) return relative.format(days, "day");
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

export function KindPicker({ value, onChange }: { value: Kind; onChange: (kind: Kind) => void }) {
  return (
    <div role="radiogroup" aria-label="Kind" className="flex flex-wrap gap-1.5">
      {KINDS.map((kind) => (
        <button
          key={kind}
          type="button"
          role="radio"
          aria-checked={value === kind}
          onClick={() => onChange(kind)}
          className={cn(
            "h-7 cursor-pointer rounded-md border px-2.5 text-xs transition-colors",
            value === kind ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-state-hover hover:text-foreground",
          )}
        >
          {KIND_LABELS[kind].one}
        </button>
      ))}
    </div>
  );
}

export function TagInput({ tags, onChange }: { tags: readonly string[]; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    if (draft.trim() === "") return;
    onChange(normalizeTags([...tags, ...draft.split(",")]));
    setDraft("");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      if (draft.trim() === "") return;
      event.preventDefault();
      commit();
    } else if (event.key === "Backspace" && draft === "" && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  };
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input px-2 py-1.5 focus-within:ring-1 focus-within:ring-ring">
      {tags.map((tag) => (
        <TagChip key={tag} tag={tag} active onRemove={() => onChange(tags.filter((candidate) => candidate !== tag))} />
      ))}
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        placeholder={tags.length === 0 ? "Add tags, e.g. S6a, Attach" : "Add tag"}
        aria-label="Add tag"
        className="h-6 min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

export const Textarea = forwardRef<HTMLTextAreaElement, ComponentProps<"textarea">>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export function Field({ label, group = false, children }: { label: string; group?: boolean; children: ReactNode }) {
  const Wrapper = group ? "div" : "label";
  return (
    <Wrapper className="grid gap-1.5 text-sm">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </Wrapper>
  );
}
