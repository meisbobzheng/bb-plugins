import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { PluginEntry } from "./data";

export interface Shortcut {
  key: string;
  mod?: boolean;
  shift?: boolean;
}

export interface Action {
  id: string;
  title: string;
  icon: LucideIcon;
  shortcut?: Shortcut;
  destructive?: boolean;
  keepOpen?: boolean;
  run(): void | Promise<void>;
}

export type Preview =
  | { kind: "thread"; threadId: string }
  | { kind: "project"; projectId: string }
  | { kind: "plugin"; plugin: PluginEntry }
  | { kind: "note"; title: string; body: string };

export interface Item {
  id: string;
  title: ReactNode;
  subtitle?: ReactNode;
  terms?: readonly string[];
  icon: ReactNode;
  accessory?: ReactNode;
  preview?: Preview;
  usageKey?: string;
  actions: readonly Action[];
}

export interface Section {
  title: string;
  items: readonly Item[];
}

export type Page =
  | { kind: "root" }
  | { kind: "project"; projectId: string }
  | { kind: "pick-project"; prompt: string | null }
  | { kind: "actions"; item: Item }
  | { kind: "settings" }
  | { kind: "themes" }
  | { kind: "providers" }
  | { kind: "plugins" }
  | { kind: "plugin"; pluginId: string }
  | { kind: "choices"; title: string; sections: readonly Section[] }
  | { kind: "input"; title: string; placeholder: string; submitLabel: string; submit(value: string): void | Promise<void> };

export interface Controls {
  push(page: Page, query?: string): void;
  pop(): void;
  close(): void;
  goTo(path: string): void;
}
