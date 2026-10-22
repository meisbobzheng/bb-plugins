import type { Repeat, ShuffleOptions } from "../../../contract";

export type Tab = "tracks" | "stats" | "history" | "search";
export const VISUALIZERS = ["bars", "mirror", "scope", "off"] as const;
export type Visualizer = (typeof VISUALIZERS)[number];

export type ConsoleCommand =
  | { kind: "play"; playlist: string | null }
  | { kind: "pause" }
  | { kind: "next" }
  | { kind: "previous" }
  | { kind: "volume"; percent: number }
  | { kind: "seek"; ms: number }
  | { kind: "shuffle"; patch: Partial<ShuffleOptions> }
  | { kind: "like"; liked: boolean }
  | { kind: "share"; how: "link" | "uri" | "card" | "thread" }
  | { kind: "search"; query: string }
  | { kind: "repeat"; state: Repeat }
  | { kind: "tab"; tab: Tab }
  | { kind: "visualizer"; mode: Visualizer }
  | { kind: "open" }
  | { kind: "help" };

export const COMMAND_NAMES = [
  "play ",
  "pause",
  "next",
  "prev",
  "vol ",
  "seek ",
  "shuffle --spread --fresh 30d --no-skips",
  "vibe ",
  "like",
  "unlike",
  "share link",
  "share uri",
  "share card",
  "share thread",
  "search ",
  "repeat off",
  "repeat all",
  "repeat one",
  "tracks",
  "stats",
  "history",
  "vis bars",
  "vis mirror",
  "vis scope",
  "vis off",
  "open",
  "help",
];

export function complete(input: string): string | null {
  const text = input.replace(/^:/, "");
  if (text === "") return null;
  return COMMAND_NAMES.find((name) => name.startsWith(text) && name !== text) ?? null;
}

function parseSeek(text: string): number | null {
  const clock = text.match(/^(\d+):([0-5]\d)$/);
  if (clock) return (Number(clock[1]) * 60 + Number(clock[2])) * 1000;
  return /^\d+$/.test(text) ? Number(text) * 1000 : null;
}

function parseShuffle(args: string): Partial<ShuffleOptions> | string {
  const patch: Partial<ShuffleOptions> = {};
  const vibe = args.match(/vibe\s+"([^"]*)"|vibe\s+(.+)$/);
  const rest = vibe ? args.replace(vibe[0], " ") : args;
  if (vibe) patch.vibe = (vibe[1] ?? vibe[2] ?? "").trim() || null;
  const tokens = rest.split(/\s+/).filter(Boolean);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token === "--spread" || token === "spread") patch.spread = true;
    else if (token === "--no-spread") patch.spread = false;
    else if (token === "--fresh" || token === "fresh") {
      patch.fresh = true;
      const days = tokens[index + 1]?.match(/^(\d+)d?$/);
      if (days) {
        patch.freshDays = Math.max(1, Math.min(365, Number(days[1])));
        index += 1;
      }
    } else if (token === "--no-fresh") patch.fresh = false;
    else if (token === "--no-skips" || token === "noskips") patch.noSkips = true;
    else if (token === "--skips") patch.noSkips = false;
    else if (token === "plain") Object.assign(patch, { spread: false, fresh: false, noSkips: false, vibe: null });
    else return `shuffle does not know ${token}`;
  }
  return patch;
}

export function parseCommand(input: string): ConsoleCommand | { error: string } {
  const text = input.trim().replace(/^:/, "").trim();
  const [head = "", ...restParts] = text.split(/\s+/);
  const rest = restParts.join(" ").trim();
  switch (head.toLowerCase()) {
    case "play":
      return { kind: "play", playlist: rest === "" ? null : rest };
    case "pause":
      return { kind: "pause" };
    case "next":
    case "n":
      return { kind: "next" };
    case "prev":
    case "previous":
    case "back":
      return { kind: "previous" };
    case "vol":
    case "volume": {
      const percent = Number(rest);
      return rest !== "" && Number.isInteger(percent) && percent >= 0 && percent <= 100 ? { kind: "volume", percent } : { error: "vol takes a number from 0 to 100" };
    }
    case "seek": {
      const ms = parseSeek(rest);
      return ms === null ? { error: "seek takes m:ss or seconds" } : { kind: "seek", ms };
    }
    case "shuffle": {
      const patch = parseShuffle(rest);
      return typeof patch === "string" ? { error: patch } : { kind: "shuffle", patch };
    }
    case "vibe":
      return rest === "" ? { error: 'vibe takes a description, like :vibe "start mellow, end euphoric"' } : { kind: "shuffle", patch: { vibe: rest.replace(/^"|"$/g, "") } };
    case "like":
    case "save":
      return { kind: "like", liked: true };
    case "unlike":
      return { kind: "like", liked: false };
    case "share": {
      const how = rest === "" ? "link" : rest;
      return how === "link" || how === "uri" || how === "card" || how === "thread" ? { kind: "share", how } : { error: "share takes link, uri, card, or thread" };
    }
    case "search":
      return rest === "" ? { error: "search takes words to look for" } : { kind: "search", query: rest };
    case "repeat": {
      const state = rest === "all" || rest === "context" ? "context" : rest === "one" || rest === "track" ? "track" : rest === "off" ? "off" : null;
      return state === null ? { error: "repeat takes off, all, or one" } : { kind: "repeat", state };
    }
    case "tracks":
    case "stats":
    case "history":
      return { kind: "tab", tab: head.toLowerCase() as Tab };
    case "vis": {
      const mode = VISUALIZERS.find((name) => name === rest);
      return mode === undefined ? { error: "vis takes bars, mirror, scope, or off" } : { kind: "visualizer", mode };
    }
    case "open":
      return { kind: "open" };
    case "help":
    case "?":
      return { kind: "help" };
    case "":
      return { error: "type a command, or :help" };
    default:
      return { error: `not a command: ${head}` };
  }
}

export function describeOptions(options: ShuffleOptions): string {
  const flags = [options.spread ? "--spread" : null, options.fresh ? `--fresh ${options.freshDays}d` : null, options.noSkips ? "--no-skips" : null].filter(Boolean);
  return [options.vibe ? `vibe "${options.vibe}"` : null, ...flags].filter(Boolean).join(" ");
}
