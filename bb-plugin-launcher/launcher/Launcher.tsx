import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  experimental_usePluginId,
  experimental_useProviders,
  experimental_useSidebarThreads,
  useBbContext,
  useBbNavigate,
  useSdk,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import { ArrowLeft, Search } from "lucide-react";
import { usePortalScopeProps } from "@/lib/portal-scope";
import { LauncherContext, type LauncherContextValue } from "./context";
import { useAppConfig, useLauncherState, type AppConfig, type AsyncState } from "./data";
import { MOD_K, matchesShortcut } from "./keys";
import {
  ActionsPage,
  ChoicesPage,
  InputPage,
  PickProjectPage,
  ProjectPage,
  RootPage,
} from "./pages";
import { PluginPage, PluginsPage, usePlugins } from "./plugins";
import { projectKey } from "./rank";
import { ResultsHostContext, type KeyHandler, type ResultsHost } from "./Results";
import { ProvidersPage, SettingsPage, ThemesPage } from "./settings";
import { launcher, useLauncherOpen } from "./store";
import type { Controls, Page } from "./types";

interface Frame {
  page: Page;
  query: string;
}

const PLACEHOLDERS: Record<Page["kind"], string> = {
  root: "Search threads, projects, settings, and plugins, or type a prompt…",
  project: "Search this project's threads, or type a prompt…",
  "pick-project": "Choose a project…",
  actions: "Search actions…",
  settings: "Search settings…",
  themes: "Search themes…",
  providers: "Search agents…",
  plugins: "Search plugins…",
  plugin: "Search plugin settings…",
  choices: "Search…",
  input: "",
};

function useModKInterceptor(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (launcher.isOpen() || event.repeat || !matchesShortcut(event, MOD_K)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      launcher.open();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [enabled]);
}

function navigateInApp(anchor: HTMLAnchorElement, path: string) {
  anchor.setAttribute("href", path);
  const fallback = (event: MouseEvent) => {
    if (event.defaultPrevented) return;
    event.preventDefault();
    window.history.pushState({ usr: null, key: Math.random().toString(36).slice(2), idx: (window.history.state?.idx ?? 0) + 1 }, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
  window.addEventListener("click", fallback, { once: true });
  anchor.click();
  window.removeEventListener("click", fallback);
}

function pageTitle(page: Page, ctx: LauncherContextValue): string | null {
  switch (page.kind) {
    case "root":
      return null;
    case "project":
      return ctx.projectsById.get(page.projectId)?.name ?? "Project";
    case "pick-project":
      return page.prompt === null ? "New thread" : "Ask in project";
    case "actions":
      return "Actions";
    case "settings":
      return "Settings";
    case "themes":
      return "Theme";
    case "providers":
      return "Default agent";
    case "plugins":
      return "Plugins";
    case "plugin":
      return "Plugin";
    case "choices":
    case "input":
      return page.title;
  }
}

function PageView({ frame, showPreview }: { frame: Frame; showPreview: boolean }) {
  const { page, query } = frame;
  const props = { query, showPreview };
  switch (page.kind) {
    case "root":
      return <RootPage {...props} />;
    case "project":
      return <ProjectPage {...props} projectId={page.projectId} />;
    case "pick-project":
      return <PickProjectPage {...props} prompt={page.prompt} />;
    case "actions":
      return <ActionsPage {...props} item={page.item} />;
    case "settings":
      return <SettingsPage {...props} />;
    case "themes":
      return <ThemesPage {...props} />;
    case "providers":
      return <ProvidersPage {...props} />;
    case "plugins":
      return <PluginsPage {...props} />;
    case "plugin":
      return <PluginPage {...props} pluginId={page.pluginId} />;
    case "choices":
      return <ChoicesPage {...props} sections={page.sections} />;
    case "input":
      return <InputPage {...props} page={page} />;
  }
}

interface LauncherWindowProps {
  showPreview: boolean;
  launcherState: ReturnType<typeof useLauncherState>;
  config: AsyncState<AppConfig>;
}

function LauncherWindow({ showPreview, launcherState, config }: LauncherWindowProps) {
  const [stack, setStack] = useState<Frame[]>([{ page: { kind: "root" }, query: "" }]);
  const top = stack[stack.length - 1]!;
  const inputRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<HTMLAnchorElement>(null);
  const keyHandler = useRef<KeyHandler | null>(null);
  const listboxId = useId();
  const [selections] = useState(() => new WeakMap<Page, string>());
  const scopeProps = usePortalScopeProps();

  const sdk = useSdk();
  const navigate = useBbNavigate();
  const pluginId = experimental_usePluginId();
  const bbContext = useBbContext();
  const { threads, projects } = experimental_useSidebarThreads();
  const { providers } = experimental_useProviders();
  const { state, recordUse, setProjectPinned } = launcherState;
  const plugins = usePlugins();
  const [now] = useState(Date.now);

  const controls = useMemo<Controls>(
    () => ({
      push: (page, query = "") => setStack((current) => [...current, { page, query }]),
      pop: () => setStack((current) => (current.length > 1 ? current.slice(0, -1) : current)),
      close: launcher.close,
      goTo: (path) => {
        if (anchorRef.current !== null) navigateInApp(anchorRef.current, path);
        launcher.close();
      },
    }),
    [],
  );

  const ctx = useMemo((): LauncherContextValue => {
    const projectsById = new Map(projects.map((project) => [project.id, project]));
    const activeThreadProject = threads.find((thread) => thread.id === bbContext.threadId)?.projectId;
    const frecentProject = [...projects].sort(
      (a, b) => (state.usage[projectKey(b.id)]?.lastUsedAt ?? 0) - (state.usage[projectKey(a.id)]?.lastUsedAt ?? 0),
    )[0]?.id;
    return {
      sdk,
      navigate,
      controls,
      pluginId,
      now,
      state,
      recordUse,
      setProjectPinned,
      threads,
      projects,
      projectsById,
      currentProjectId: bbContext.projectId ?? activeThreadProject ?? frecentProject ?? null,
      providers: new Map(providers.map((provider) => [provider.id, provider])),
      config,
      plugins,
    };
  }, [sdk, navigate, controls, pluginId, now, state, recordUse, setProjectPinned, threads, projects, providers, bbContext, config, plugins]);

  const host = useMemo(
    (): ResultsHost => ({
      keyHandler,
      input: inputRef,
      listboxId,
      restoreSelection: () => selections.get(top.page) ?? null,
      saveSelection: (id) => selections.set(top.page, id),
    }),
    [listboxId, selections, top.page],
  );

  useEffect(() => inputRef.current?.focus(), [stack.length]);

  const setQuery = (query: string) =>
    setStack((current) => [...current.slice(0, -1), { ...current[current.length - 1]!, query }]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const atRoot = stack.length === 1;
    if (!atRoot && event.key === "Backspace" && top.query === "") {
      event.preventDefault();
      controls.pop();
      return;
    }
    if (top.page.kind === "actions" && matchesShortcut(event, MOD_K)) {
      event.preventDefault();
      controls.pop();
      return;
    }
    if (keyHandler.current?.(event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const title = pageTitle(top.page, ctx);
  const placeholder = top.page.kind === "input" ? top.page.placeholder : PLACEHOLDERS[top.page.kind];

  return (
    <Dialog.Content
      {...scopeProps}
      aria-describedby={undefined}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        inputRef.current?.focus();
      }}
      onEscapeKeyDown={(event) => {
        if (stack.length === 1) return;
        event.preventDefault();
        controls.pop();
      }}
      className="fixed left-1/2 top-[12vh] z-50 flex h-[min(560px,76vh)] w-[min(880px,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl outline-none"
    >
      <Dialog.Title className="sr-only">Launcher</Dialog.Title>
      <LauncherContext.Provider value={ctx}>
        <ResultsHostContext.Provider value={host}>
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
            {stack.length > 1 ? (
              <button
                type="button"
                aria-label="Back"
                onClick={controls.pop}
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground"
              >
                <ArrowLeft className="size-4" />
              </button>
            ) : (
              <Search className="mx-1.5 size-4 text-muted-foreground" aria-hidden />
            )}
            {title === null ? null : (
              <span className="max-w-48 shrink-0 truncate rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {title}
              </span>
            )}
            <input
              ref={inputRef}
              value={top.query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
              role="combobox"
              aria-expanded
              aria-controls={listboxId}
              aria-autocomplete="list"
              placeholder={placeholder}
              aria-label={placeholder || title || "Search"}
              spellCheck={false}
              autoComplete="off"
              className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
          <PageView key={stack.length} frame={top} showPreview={showPreview} />
        </ResultsHostContext.Provider>
      </LauncherContext.Provider>
      <a ref={anchorRef} href="/" hidden tabIndex={-1} aria-hidden />
    </Dialog.Content>
  );
}

export function LauncherOverlay() {
  const open = useLauncherOpen();
  const { values } = useSettings();
  const scopeProps = usePortalScopeProps();
  const launcherState = useLauncherState();
  const config = useAppConfig(open);
  useModKInterceptor(values?.replaceShortcut !== false);
  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? launcher.open() : launcher.close())}>
      <Dialog.Portal>
        <Dialog.Overlay {...scopeProps} className="fixed inset-0 z-50 bg-black/30" />
        {open ? <LauncherWindow showPreview={values?.showPreview !== false} launcherState={launcherState} config={config} /> : null}
      </Dialog.Portal>
    </Dialog.Root>
  );
}
