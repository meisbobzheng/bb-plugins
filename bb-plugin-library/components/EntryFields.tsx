import { useState } from "react";
import { Markdown } from "@get-bb/plugin-sdk/app";
import { Input } from "./ui/input";
import { cn } from "../lib/utils";
import { LIMITS, guessKind, guessTitle, type Kind, type TagRef } from "../library";
import { detectTags, termFor } from "../glossary";
import { Field, KindPicker, TagInput, Textarea } from "./bits";

export interface Draft {
  title: string;
  kind: Kind;
  summary: string;
  body: string;
  tags: TagRef[];
}

export function draftFromText(text: string): Draft {
  const tags = detectTags(text).map((tag): TagRef => ({ tag, group: termFor(tag)?.group ?? "other" }));
  return { title: guessTitle(text), kind: guessKind(text), summary: "", body: text, tags };
}

export function isDraftValid(draft: Draft): boolean {
  return draft.title.trim() !== "" && draft.body.trim() !== "";
}

interface EntryFieldsProps {
  draft: Draft;
  onChange: (draft: Draft) => void;
  initialBodyMode: "preview" | "markdown";
  autoFocusTitle?: boolean;
  bodyClassName?: string;
}

export function EntryFields({ draft, onChange, initialBodyMode, autoFocusTitle = false, bodyClassName }: EntryFieldsProps) {
  const [bodyMode, setBodyMode] = useState(initialBodyMode);
  const set = <Key extends keyof Draft>(key: Key, value: Draft[Key]) => onChange({ ...draft, [key]: value });
  return (
    <div className="grid gap-4">
      <Field label="Title">
        <Input
          value={draft.title}
          maxLength={LIMITS.title}
          autoFocus={autoFocusTitle}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => set("title", event.target.value)}
        />
      </Field>
      <Field label="Kind" group>
        <KindPicker value={draft.kind} onChange={(kind) => set("kind", kind)} />
      </Field>
      <Field label="Tags" group>
        <TagInput tags={draft.tags} onChange={(tags) => set("tags", tags)} />
      </Field>
      <Field label="Summary">
        <Input
          value={draft.summary}
          maxLength={LIMITS.summary}
          placeholder="Optional one-line summary"
          onChange={(event) => set("summary", event.target.value)}
        />
      </Field>
      <Field label="Content" group>
        <div className="flex gap-1 text-xs" role="tablist" aria-label="Content view">
          {(["preview", "markdown"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={bodyMode === mode}
              onClick={() => setBodyMode(mode)}
              className={cn(
                "h-6 cursor-pointer rounded px-2 capitalize text-muted-foreground hover:text-foreground",
                bodyMode === mode && "bg-state-active text-foreground",
              )}
            >
              {mode}
            </button>
          ))}
        </div>
        {bodyMode === "preview" ? (
          <div className={cn("overflow-auto rounded-md border border-border px-3 py-2", bodyClassName)}>
            <Markdown content={draft.body} />
          </div>
        ) : (
          <Textarea
            value={draft.body}
            maxLength={LIMITS.body}
            spellCheck={false}
            aria-label="Markdown"
            className={cn("resize-y font-mono text-xs leading-5", bodyClassName)}
            onChange={(event) => set("body", event.target.value)}
          />
        )}
      </Field>
    </div>
  );
}
