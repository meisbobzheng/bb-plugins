import { termFor } from "../glossary";
import { cn } from "../lib/utils";
import { TAG_GROUP_INFO, groupTags, type TagGroup, type TagRef } from "../library";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Icon } from "./ui/icon";

type MenuTag = TagRef & { count?: number };

const SELF_DESCRIBING: ReadonlySet<TagGroup> = new Set(["procedures", "status", "docs"]);

function TagOption({ tag }: { tag: MenuTag }) {
  const term = termFor(tag.tag);
  const about = term === undefined || SELF_DESCRIBING.has(term.group) ? null : term.about;
  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-2">
      <span className="shrink-0 font-medium text-foreground">{tag.tag}</span>
      {about === null ? null : <span className="min-w-0 flex-1 truncate text-muted-foreground">{about}</span>}
      {tag.count === undefined ? null : <span className="ml-auto shrink-0 pl-2 tabular-nums text-muted-foreground">{tag.count}</span>}
    </span>
  );
}

interface TagMenusProps {
  tags: readonly MenuTag[];
  label: string;
  selected?: ReadonlySet<string>;
  onToggle?: (tag: string) => void;
  onPick?: (tag: string) => void;
}

export function TagMenus({ tags, label, selected, onToggle, onPick }: TagMenusProps) {
  const groups = groupTags(tags);
  if (groups.length === 0) return null;
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {groups.map(({ group, tags: members }) => {
        const name = TAG_GROUP_INFO[group].label;
        const names = members.map(({ tag }) => tag).join(", ");
        const chosen = members.filter(({ tag }) => selected?.has(tag.toLowerCase())).length;
        const description =
          onToggle === undefined
            ? `${name}: ${names}`
            : `${name}, ${members.length} tag${members.length === 1 ? "" : "s"}${chosen === 0 ? "" : `, ${chosen} selected`}`;
        return (
          <DropdownMenu key={group}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={description}
                title={onToggle === undefined ? names : undefined}
                className={cn(
                  "inline-flex h-6 cursor-pointer items-center gap-1 rounded-full border px-2 text-xs transition-colors hover:bg-state-hover hover:text-foreground data-[state=open]:bg-state-active data-[state=open]:text-foreground",
                  chosen === 0 ? "border-border text-muted-foreground" : "border-foreground/40 bg-foreground/10 text-foreground",
                )}
              >
                <span>{name}</span>
                <span className="tabular-nums opacity-70">{members.length}</span>
                {chosen === 0 ? null : (
                  <span className="rounded-full bg-foreground px-1.5 text-[10px] font-medium leading-4 text-background">{chosen}</span>
                )}
                <Icon name="ChevronDown" className="size-3 opacity-70" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" mobileTitle={name} className="max-h-72 w-64 overflow-y-auto">
              <DropdownMenuLabel>{name}</DropdownMenuLabel>
              {members.map((tag) =>
                onToggle === undefined ? (
                  <DropdownMenuItem key={tag.tag} textValue={tag.tag} onSelect={() => onPick?.(tag.tag)}>
                    <TagOption tag={tag} />
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuCheckboxItem
                    key={tag.tag}
                    textValue={tag.tag}
                    checked={selected?.has(tag.tag.toLowerCase()) ?? false}
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={() => onToggle(tag.tag)}
                  >
                    <TagOption tag={tag} />
                  </DropdownMenuCheckboxItem>
                ),
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      })}
    </div>
  );
}
