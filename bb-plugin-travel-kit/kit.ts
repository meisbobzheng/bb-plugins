export const TRAVEL_KIT_PANEL = "travel-kit";
export const JOB_CHANNEL = "travel-kit.job";
export const JOB_LINES = 400;

export const KIND_GROUPS = [
  { group: "Apps", kinds: ["cask", "app", "mas"] },
  { group: "Command-line tools", kinds: ["formula", "tap", "npm", "uv", "pipx"] },
  { group: "Custom scripts", kinds: ["script"] },
  { group: "Shell and config", kinds: ["dotfile", "config", "claude"] },
  { group: "Repos in ~/dev", kinds: ["repo"] },
  { group: "bb", kinds: ["bb", "bbplugin", "marketplace"] },
] as const;

export const KIND_LABELS: Record<string, string> = {
  cask: "Homebrew app",
  app: "App",
  mas: "App Store",
  formula: "Homebrew",
  tap: "Homebrew tap",
  npm: "npm",
  uv: "uv tool",
  pipx: "pipx",
  script: "Script",
  dotfile: "Dotfile",
  config: "~/.config",
  claude: "Claude Code",
  repo: "Repo",
  bb: "bb",
  bbplugin: "bb plugin",
  marketplace: "Marketplace",
};

export const BB_ITEM_LABELS: Record<string, string> = {
  threads: "Threads active in the last few days, remapped to the new laptop",
  settings: "Settings, theme, and skills",
  "plugin-data": "Plugin data (auth tables and password, token, and secret fields are cleared)",
};

export type AppClass = "iru" | "manual";

export type ScanItem = {
  key: string;
  kind: string;
  name: string;
  version: string;
  extra: string;
};

export type Profile = {
  excluded: string[];
  classes: Record<string, AppClass>;
};

export const EMPTY_PROFILE: Profile = { excluded: [], classes: {} };

export function itemKey(kind: string, name: string): string {
  return `${kind}:${name}`;
}

export function parseScan(tsv: string): ScanItem[] {
  return tsv
    .split("\n")
    .filter((line) => line.trim() !== "")
    .flatMap((line) => {
      const [kind = "", name = "", version = "", extra = ""] = line.split("\t");
      return kind === "" || name === "" ? [] : [{ key: itemKey(kind, name), kind, name, version, extra }];
    });
}

export function profileTsv(profile: Profile): string {
  const rows = [
    ...profile.excluded.map((key) => ["exclude", ...splitKey(key), ""]),
    ...Object.entries(profile.classes).map(([key, value]) => ["class", ...splitKey(key), value]),
  ];
  return rows.map((row) => row.join("\t")).join("\n") + (rows.length > 0 ? "\n" : "");
}

function splitKey(key: string): [string, string] {
  const at = key.indexOf(":");
  return [key.slice(0, at), key.slice(at + 1)];
}

export function parseEnv(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split("\n")
      .map((line) => /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line))
      .flatMap((match) => (match === null ? [] : [[match[1]!, match[2]!] as const])),
  );
}
