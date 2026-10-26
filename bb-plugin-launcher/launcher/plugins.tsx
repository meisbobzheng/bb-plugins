import { experimental_Icon as Icon, experimental_copyToClipboard as copyToClipboard, useSdk } from "@get-bb/plugin-sdk/app";
import { ArrowRight, Check, Copy, ExternalLink, Pencil, Power, PowerOff, Puzzle, RefreshCw, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Toggle, ValueBadge } from "./badges";
import { useLauncher, type LauncherContextValue } from "./context";
import { errorMessage, useAsync, type AsyncState, type PluginEntry, type PluginSettings } from "./data";
import { ActionIcon } from "./items";
import { rank } from "./rank";
import { Results } from "./Results";
import type { Item, Section } from "./types";

export const pluginKey = (id: string) => `plugin:${id}`;

const STATUS_LABELS: Record<PluginEntry["status"], string> = {
  running: "Running",
  starting: "Starting",
  disabled: "Disabled",
  degraded: "Degraded",
  error: "Error",
  incompatible: "Incompatible",
  missing: "Missing",
  "needs-configuration": "Needs configuration",
};

export function pluginStatusLabel(plugin: PluginEntry): string {
  return `${STATUS_LABELS[plugin.status]} · v${plugin.version}`;
}

export function PluginIcon({ plugin }: { plugin: PluginEntry }) {
  if (plugin.iconUrl !== null) {
    const mask = `url("${plugin.iconUrl}") center / contain no-repeat`;
    return <span aria-hidden className="size-4 bg-current text-muted-foreground" style={{ mask, WebkitMask: mask }} />;
  }
  if (plugin.icon !== null) return <Icon name={plugin.icon} className="size-4 text-muted-foreground" aria-hidden />;
  return <Puzzle className="size-4 text-muted-foreground" aria-hidden />;
}

export function usePlugins(): AsyncState<PluginEntry[]> {
  const sdk = useSdk();
  return useAsync((signal) => sdk.plugins.list({ signal }).then(({ plugins }) => plugins), [sdk]);
}

function pluginsEmptyText({ data, error }: AsyncState<PluginEntry[]>, loaded: string): string {
  if (data !== undefined) return loaded;
  return error === null ? "Loading plugins…" : `Could not load plugins: ${errorMessage(error)}`;
}

export const pluginTerms = (plugin: PluginEntry) => [plugin.name ?? plugin.id, plugin.id, plugin.description ?? ""];

function setEnabledAction(ctx: LauncherContextValue, plugin: PluginEntry, reload: () => void) {
  const enabled = plugin.enabled;
  const name = plugin.name ?? plugin.id;
  return {
    id: "enabled",
    title: enabled ? "Disable plugin" : "Enable plugin",
    icon: enabled ? PowerOff : Power,
    shortcut: { key: "e", mod: true, shift: true },
    keepOpen: true,
    destructive: enabled,
    run: async () => {
      const pluginId = plugin.id;
      await (enabled ? ctx.sdk.plugins.disable({ pluginId }) : ctx.sdk.plugins.enable({ pluginId }));
      toast.success(`${name} ${enabled ? "disabled" : "enabled"}`);
      reload();
    },
  };
}

export function pluginItem(ctx: LauncherContextValue, plugin: PluginEntry, reload: () => void): Item {
  return {
    id: pluginKey(plugin.id),
    title: plugin.name ?? plugin.id,
    subtitle: plugin.description ?? undefined,
    terms: pluginTerms(plugin),
    icon: <PluginIcon plugin={plugin} />,
    accessory: <ValueBadge tone={plugin.status === "running" ? "on" : plugin.enabled ? "warn" : "off"}>{STATUS_LABELS[plugin.status]}</ValueBadge>,
    preview: { kind: "plugin", plugin },
    usageKey: pluginKey(plugin.id),
    actions: [
      {
        id: "details",
        title: "Show settings",
        icon: Settings2,
        keepOpen: true,
        run: () => ctx.controls.push({ kind: "plugin", pluginId: plugin.id }),
      },
      setEnabledAction(ctx, plugin, reload),
      {
        id: "page",
        title: "Open plugin page",
        icon: ExternalLink,
        run: () => ctx.controls.goTo(`/plugins/${encodeURIComponent(plugin.id)}`),
      },
      {
        id: "reload",
        title: "Reload plugin",
        icon: RefreshCw,
        keepOpen: true,
        run: async () => {
          await ctx.sdk.plugins.reload({ pluginId: plugin.id });
          toast.success(`${plugin.name ?? plugin.id} reloaded`);
          reload();
        },
      },
      {
        id: "copy-id",
        title: "Copy plugin ID",
        icon: Copy,
        run: async () => {
          if (await copyToClipboard({ text: plugin.id })) toast.success("Copied to clipboard");
        },
      },
    ],
  };
}

export function PluginsPage({ query, showPreview }: { query: string; showPreview: boolean }) {
  const ctx = useLauncher();
  const { data, reload } = ctx.plugins;
  const plugins = rank(data ?? [], query, pluginTerms, (plugin) => pluginKey(plugin.id), ctx.state.usage, ctx.now, 200);
  const toItem = (plugin: PluginEntry) => pluginItem(ctx, plugin, reload);
  const sections: Section[] =
    query.trim() === ""
      ? [
          { title: "Enabled", items: plugins.filter((plugin) => plugin.enabled).map(toItem) },
          { title: "Disabled", items: plugins.filter((plugin) => !plugin.enabled).map(toItem) },
        ]
      : [{ title: "Plugins", items: plugins.map(toItem) }];
  return (
    <Results sections={sections} query={query} showPreview={showPreview} emptyText={pluginsEmptyText(ctx.plugins, "No plugins")} />
  );
}

type SettingSchema = PluginSettings["schema"][string];
type SettingValue = PluginSettings["values"][string];

function formatValue(value: SettingValue | undefined): string {
  if (value === undefined || value === null || value === "") return "Not set";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function settingItem(
  ctx: LauncherContextValue,
  pluginId: string,
  key: string,
  schema: SettingSchema,
  value: SettingValue | undefined,
  reload: () => void,
): Item {
  const save = async (next: SettingValue) => {
    await ctx.sdk.plugins.updateSettings({ pluginId, values: { [key]: next } });
    toast.success(`${schema.label} updated`);
    reload();
  };
  const base = { id: `setting:${key}`, title: schema.label, subtitle: schema.description, terms: [schema.label, key] };
  const openPage = () => ctx.controls.goTo(`/plugins/${encodeURIComponent(pluginId)}`);
  switch (schema.type) {
    case "boolean": {
      const on = value === true || (value === undefined && schema.default === true);
      return {
        ...base,
        icon: <Settings2 className="size-4 text-muted-foreground" />,
        accessory: <Toggle on={on} />,
        actions: [{ id: "toggle", title: on ? "Turn off" : "Turn on", icon: Check, keepOpen: true, run: () => save(!on) }],
      };
    }
    case "select":
    case "project": {
      const options =
        schema.type === "select"
          ? schema.options.map((option) => ({ id: option, label: option }))
          : ctx.projects.map((project) => ({ id: project.id, label: project.name }));
      const current = typeof value === "string" ? value : schema.default;
      return {
        ...base,
        icon: <Settings2 className="size-4 text-muted-foreground" />,
        accessory: <ValueBadge>{options.find((option) => option.id === current)?.label ?? formatValue(value)}</ValueBadge>,
        actions: [
          {
            id: "choose",
            title: "Choose…",
            icon: ArrowRight,
            keepOpen: true,
            run: () =>
              ctx.controls.push({
                kind: "choices",
                title: schema.label,
                sections: [
                  {
                    title: schema.label,
                    items: options.map((option) => ({
                      id: option.id,
                      title: option.label,
                      terms: [option.label],
                      icon: option.id === current ? <Check className="size-4" /> : null,
                      actions: [
                        {
                          id: "pick",
                          title: "Select",
                          icon: Check,
                          keepOpen: true,
                          run: async () => {
                            ctx.controls.pop();
                            await save(option.id);
                          },
                        },
                      ],
                    })),
                  },
                ],
              }),
          },
        ],
      };
    }
    case "string":
    case "number": {
      if (schema.type === "string" && schema.secret === true) {
        return {
          ...base,
          icon: <Settings2 className="size-4 text-muted-foreground" />,
          accessory: <ValueBadge>Secret</ValueBadge>,
          actions: [{ id: "page", title: "Edit in plugin settings", icon: ExternalLink, run: openPage }],
        };
      }
      const isNumber = schema.type === "number";
      return {
        ...base,
        icon: <Settings2 className="size-4 text-muted-foreground" />,
        accessory: <ValueBadge>{formatValue(value)}</ValueBadge>,
        actions: [
          {
            id: "edit",
            title: "Edit…",
            icon: Pencil,
            keepOpen: true,
            run: () =>
              ctx.controls.push(
                {
                  kind: "input",
                  title: schema.label,
                  placeholder: isNumber ? "Enter a number" : "Enter a value",
                  submitLabel: "Set to",
                  submit: async (text) => {
                    const next = isNumber ? Number(text) : text;
                    if (isNumber && !Number.isFinite(next)) throw new Error(`“${text}” is not a number`);
                    await save(next);
                  },
                },
                value === undefined || value === null ? "" : String(value),
              ),
          },
        ],
      };
    }
  }
}

export function PluginPage({ pluginId, query, showPreview }: { pluginId: string; query: string; showPreview: boolean }) {
  const ctx = useLauncher();
  const { plugins } = ctx;
  const plugin = plugins.data?.find((candidate) => candidate.id === pluginId);
  const settings = useAsync(
    (signal) =>
      plugin?.hasSettings === true ? ctx.sdk.plugins.getSettings({ pluginId, signal }) : Promise.resolve(null),
    [ctx.sdk, pluginId, plugin?.hasSettings],
  );
  if (plugin === undefined) {
    return <Results sections={[]} query={query} showPreview={false} emptyText={pluginsEmptyText(plugins, "Plugin not found")} />;
  }
  const reload = () => {
    plugins.reload();
    settings.reload();
  };
  const general = pluginItem(ctx, plugin, reload).actions.filter((action) => action.id !== "details");
  const generalItems: Item[] = general.map((action) => ({
    id: `action:${action.id}`,
    title: action.title,
    terms: [action.title],
    icon: <ActionIcon icon={action.icon} className="size-4 text-muted-foreground" />,
    usageKey: pluginKey(plugin.id),
    actions: [action],
  }));
  const settingItems = Object.entries(settings.data?.schema ?? {}).map(([key, schema]) =>
    settingItem(ctx, pluginId, key, schema, settings.data?.values[key], reload),
  );
  const filter = (items: Item[]) =>
    rank(items, query, (item) => item.terms ?? [], (item) => item.id, {}, ctx.now, 200);
  return (
    <Results
      query={query}
      showPreview={showPreview}
      sections={[
        { title: plugin.name ?? plugin.id, items: filter(generalItems) },
        { title: "Settings", items: filter(settingItems) },
      ]}
    />
  );
}
