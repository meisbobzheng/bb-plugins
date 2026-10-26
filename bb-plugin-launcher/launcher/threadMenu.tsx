import { Check } from "lucide-react";
import type {
  PluginSidebarThread,
  PluginThreadActionEntry,
  PluginThreadActionTarget,
} from "@get-bb/plugin-sdk/app";
import { ActionIcon } from "./items";
import type { Action, Controls, Item } from "./types";

export function actionTarget(thread: PluginSidebarThread): PluginThreadActionTarget {
  const environment = thread.environment;
  return {
    id: thread.id,
    projectId: thread.projectId,
    parentThreadId: thread.parentThreadId,
    archivedAt: thread.archivedAt,
    pinnedAt: thread.pinnedAt,
    sectionId: thread.sectionId,
    isUnread: thread.isUnread,
    status: thread.status,
    environment: environment?.id ? { id: environment.id, path: environment.path } : null,
  };
}

const FILLER = new Set(["thread", "as", "the", "this"]);

export function actionLabelKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word !== "" && !FILLER.has(word))
    .join(" ");
}

function choicesPage(entry: PluginThreadActionEntry): Parameters<Controls["push"]>[0] {
  const { action } = entry;
  const choices = action.choices!;
  const items = choices.items
    .filter((choice) => !choice.disabled)
    .map(
      (choice): Item => ({
        id: `choice:${choice.id}`,
        title: choice.label,
        terms: [choice.label],
        icon: <ActionIcon icon={choice.icon ?? action.icon} className="size-4 text-muted-foreground" />,
        accessory: choice.selected ? <Check className="size-4 text-muted-foreground" aria-label="Current" /> : null,
        actions: [{ id: choice.id, title: choice.label, icon: choice.icon ?? action.icon, run: () => action.run(choice.id) }],
      }),
    );
  return { kind: "choices", title: choices.heading ?? action.label, sections: [{ title: choices.hint ?? action.label, items }] };
}

export function registryActions(
  entries: readonly PluginThreadActionEntry[],
  builtIn: readonly Action[],
  controls: Controls,
): Action[] {
  const taken = new Set(builtIn.map((action) => actionLabelKey(action.title)));
  return entries.flatMap(({ key, action, ...entry }): Action[] => {
    const label = actionLabelKey(action.label);
    if (action.disabled || taken.has(label)) return [];
    taken.add(label);
    const base = { id: `registry:${key}`, title: action.label, icon: action.icon, destructive: action.variant === "destructive" };
    if (action.choices === undefined) return [{ ...base, run: () => action.run() }];
    const page = choicesPage({ key, action, ...entry });
    return [{ ...base, title: `${action.label}…`, keepOpen: true, run: () => controls.push(page) }];
  });
}
