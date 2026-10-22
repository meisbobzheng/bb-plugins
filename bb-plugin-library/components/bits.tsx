import {
  Fragment,
  forwardRef,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Button } from "./ui/button";
import { Icon } from "./ui/icon";
import { cn } from "../lib/utils";
import { cleanTag, termFor } from "../glossary";
import {
  ASSIGNABLE_GROUPS,
  KINDS,
  KIND_LABELS,
  LIMITS,
  MARK_END,
  MARK_START,
  TAG_GROUP_INFO,
  groupTags,
  type Kind,
  type TagGroup,
  type TagRef,
} from "../library";
import { useTagCatalog } from "./hooks";

export function KindBadge({ kind, className }: { kind: Kind; className?: string }) {
  return (
    <span className={cn("shrink-0 rounded border border-border px-1.5 py-px text-[11px] leading-4 text-muted-foreground", className)}>
      {KIND_LABELS[kind].one}
    </span>
  );
}

export function tagTooltip(tag: string, group?: TagGroup): string | undefined {
  const term = termFor(tag);
  if (term === undefined) return group === undefined ? undefined : TAG_GROUP_INFO[group].label;
  return term.specs.length === 0 ? term.about : `${term.about} · ${term.specs.join(", ")}`;
}

interface TagChipProps {
  tag: string;
  group?: TagGroup;
  count?: number;
  active?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
}

export function TagChip({ tag, group, count, active = false, onClick, onRemove }: TagChipProps) {
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
    <span className={chip} title={tagTooltip(tag, group)}>
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

export function ErrorState({ message, error, onRetry }: { message: string; error: string; onRetry: () => void }) {
  return (
    <div role="alert" className="space-y-2 text-sm">
      <p className="text-destructive">{message}</p>
      <p className="break-words text-xs text-muted-foreground">{error}</p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        <Icon name="RotateCcw" />
        Try again
      </Button>
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

export function GroupedTags<T extends TagRef>({ tags, chip }: { tags: readonly T[]; chip: (tag: T) => ReactNode }) {
  return (
    <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5 text-xs">
      {groupTags(tags).map(({ group, tags: members }) => (
        <Fragment key={group}>
          <dt className="pt-1 text-muted-foreground">{TAG_GROUP_INFO[group].label}</dt>
          <dd className="flex min-w-0 flex-wrap gap-1.5">{members.map(chip)}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

type AssignableGroup = (typeof ASSIGNABLE_GROUPS)[number];

export function TagInput({ tags, onChange }: { tags: readonly TagRef[]; onChange: (tags: TagRef[]) => void }) {
  const catalog = useTagCatalog();
  const listId = useId();
  const container = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  const [group, setGroup] = useState<AssignableGroup>("topics");
  const builtIn = termFor(draft.trim());

  const resolve = (name: string): TagRef => {
    const term = termFor(name);
    return term === undefined ? { tag: name, group } : { tag: term.tag, group: term.group };
  };

  const commit = () => {
    const names = draft.split(",").flatMap((raw) => cleanTag(raw) ?? []);
    if (names.length === 0) return;
    const next = [...tags];
    for (const ref of names.map(resolve)) {
      const index = next.findIndex(({ tag }) => tag.toLowerCase() === ref.tag.toLowerCase());
      if (index < 0) next.push(ref);
      else next[index] = ref;
    }
    onChange(next.slice(0, LIMITS.tags));
    setDraft("");
  };

  const onDraftChange = (value: string) => {
    setDraft(value);
    const known = catalog.get(value.trim().toLowerCase());
    if (known !== undefined && known.group !== "other" && !known.builtIn) setGroup(known.group);
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

  const onBlur = (event: FocusEvent) => {
    if (!container.current?.contains(event.relatedTarget as Node | null)) commit();
  };

  return (
    <div ref={container} onBlur={onBlur} className="space-y-2 rounded-md border border-input p-2 focus-within:ring-1 focus-within:ring-ring">
      {tags.length === 0 ? null : (
        <GroupedTags
          tags={tags}
          chip={(ref) => (
            <TagChip
              key={ref.tag}
              tag={ref.tag}
              group={ref.group}
              active
              onRemove={() => onChange(tags.filter(({ tag }) => tag !== ref.tag))}
            />
          )}
        />
      )}
      <div className="flex items-center gap-2">
        <input
          value={draft}
          list={listId}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={tags.length === 0 ? "Add tags, e.g. Outbox, Not Implemented" : "Add tag"}
          aria-label="Add tag"
          className="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        <select
          aria-label="Group for the new tag"
          title={builtIn === undefined ? "Group for the new tag. Adding a tag again with another group moves it." : "Built-in telecom tags keep their group."}
          value={builtIn?.group ?? group}
          disabled={builtIn !== undefined}
          onChange={(event) => setGroup(event.target.value as AssignableGroup)}
          className="h-7 shrink-0 cursor-pointer rounded-md border border-input bg-background px-1.5 text-xs text-foreground disabled:cursor-default disabled:opacity-60"
        >
          {(builtIn === undefined ? ASSIGNABLE_GROUPS : [builtIn.group]).map((option) => (
            <option key={option} value={option}>
              {TAG_GROUP_INFO[option].label}
            </option>
          ))}
        </select>
        <datalist id={listId}>
          {[...catalog.values()].map(({ tag }) => (
            <option key={tag} value={tag} />
          ))}
        </datalist>
      </div>
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
