import { createContext, useContext } from "react";
import type {
  BbNavigate,
  PluginProvidersState,
  PluginSidebarProject,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import type { LauncherState } from "../model";
import type { AppConfig, AsyncState, Sdk } from "./data";
import type { Controls } from "./types";

export type ProviderInfo = PluginProvidersState["providers"][number];

export interface LauncherContextValue {
  sdk: Sdk;
  navigate: BbNavigate;
  controls: Controls;
  pluginId: string;
  now: number;
  state: LauncherState;
  recordUse(key: string): void;
  setProjectPinned(projectId: string, pinned: boolean): Promise<void>;
  threads: readonly PluginSidebarThread[];
  projects: readonly PluginSidebarProject[];
  projectsById: ReadonlyMap<string, PluginSidebarProject>;
  currentProjectId: string | null;
  providers: ReadonlyMap<string, ProviderInfo>;
  config: AsyncState<AppConfig>;
}

export const LauncherContext = createContext<LauncherContextValue | null>(null);

export function useLauncher(): LauncherContextValue {
  const value = useContext(LauncherContext);
  if (value === null) throw new Error("useLauncher must be used inside the launcher");
  return value;
}
