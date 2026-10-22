import { spawn } from "node:child_process";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { CHANNELS, launcherContract, PALETTE_NAMES, PALETTE_SETTING, PALETTES, rpcContract, SKIN_NAMES, SKINS } from "./contract";
import { createDucker } from "./duck";
import { createService } from "./service";
import { createStore } from "./store";

export { launcherContract, rpcContract };

const labels = (values: readonly string[]) => Object.fromEntries(values.map((value) => [value, PALETTE_NAMES[value] ?? value]));

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

function callbackPage(ok: boolean, text: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Spotify for bb</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0d10;color:#e7e9ec;font:15px/1.5 ui-monospace,Menlo,monospace}
main{max-width:460px;padding:28px;border:1px solid #252a32}b{color:${ok ? "#ffc72c" : "#e5484d"}}p{color:#9aa1ab}</style></head>
<body><main><b>${ok ? "♫ connected" : "✕ not connected"}</b><h1 style="font-size:18px;margin:8px 0">${escapeHtml(text)}</h1>
<p>${ok ? "You can close this tab and go back to bb." : "Close this tab and try again from bb."}</p></main></body></html>`;
}

function launchSpotifyApp(): Promise<boolean> {
  if (process.platform !== "darwin") return Promise.resolve(false);
  return new Promise((resolve) => {
    const child = spawn("open", ["-a", "Spotify"], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    clientId: {
      type: "string",
      label: "Spotify app Client ID",
      description: "From your app at developer.spotify.com/dashboard. The Spotify section below lists the redirect URI to add there.",
      default: "",
      experimental_schema: z.string().trim().regex(/^([0-9a-f]{32})?$/i, "A Spotify Client ID is 32 letters and digits"),
    },
    skin: { type: "select", label: "Look", options: [...SKINS], experimental_optionLabels: SKIN_NAMES, default: "console" },
    consolePalette: { type: "select", label: "Console palette", options: [...PALETTES.console], experimental_optionLabels: labels(PALETTES.console), default: "cape" },
    receiverPalette: { type: "select", label: "Receiver palette", options: [...PALETTES.receiver], experimental_optionLabels: labels(PALETTES.receiver), default: "silver" },
    linerNotesPalette: {
      type: "select",
      label: "Liner Notes palette",
      options: [...PALETTES["liner-notes"]],
      experimental_optionLabels: labels(PALETTES["liner-notes"]),
      default: "vermilion",
    },
    pastelPalette: { type: "select", label: "Sticker Book palette", options: [...PALETTES.pastel], experimental_optionLabels: labels(PALETTES.pastel), default: "sherbet" },
    duckMode: {
      type: "select",
      label: "When an agent thread needs your approval",
      options: ["lower", "pause", "off"],
      experimental_optionLabels: { lower: "Lower the volume", pause: "Pause the music", off: "Do nothing" },
      default: "lower",
    },
    duckVolume: { type: "number", label: "Lowered volume (%)", default: 20, experimental_schema: z.number().int().min(0).max(100) },
    historyEnabled: { type: "boolean", label: "Keep a listening history", description: "Powers stats and the Fresh and No-skips shuffles. Stored only in this plugin's database.", default: true },
    vibeModel: { type: "string", label: "Model for vibe shuffles (claude --model)", default: "sonnet" },
    claudePath: { type: "string", label: "claude CLI path", default: "claude" },
  });

  const store = createStore(bb.storage);
  const callbackPath = "/callback";

  const service = createService({
    store,
    kv: bb.storage.kv,
    fetch: (input, init) => fetch(input, init),
    async settings() {
      const current = await settings.get();
      return { clientId: current.clientId, vibeModel: current.vibeModel, claudePath: current.claudePath, historyEnabled: current.historyEnabled };
    },
    redirectUri: () => `${bb.server.loopbackBaseUrl}/api/v1/plugins/${bb.pluginId}/http${callbackPath}`,
    publish: (channel, payload) => bb.realtime.publish(channel, payload),
    log: (message) => bb.log.warn(message),
    launchApp: launchSpotifyApp,
    duckState: () => ducker.state(),
  });

  const ducker = createDucker({
    async settings() {
      const current = await settings.get();
      return { mode: current.duckMode as "lower" | "pause" | "off", volumePercent: current.duckVolume };
    },
    player: {
      async snapshot() {
        const current = await service.playerState(true);
        if (current.status !== "ok") return null;
        return { isPlaying: current.isPlaying, volumePercent: current.device?.supportsVolume ? current.device.volumePercent : null, trackId: current.track?.id ?? null };
      },
      setVolume: async (percent) => void (await service.command({ kind: "volume", percent })),
      pause: async () => void (await service.command({ kind: "pause" })),
      resume: async () => void (await service.command({ kind: "play" })),
    },
    isPending: async (threadId) => (await bb.sdk.threads.interactions.list({ threadId })).length > 0,
    onChange: () => service.refreshDuck(),
    log: (message) => bb.log.warn(message),
  });

  bb.events.on("interaction.pending", ({ thread }) => void ducker.pending(thread.id, thread.title ?? thread.titleFallback ?? "A thread"));
  const recheck = ({ thread }: { thread: { id: string } }) => {
    if (ducker.tracking()) void ducker.reconcile([thread.id]);
  };
  bb.events.on("thread.active", recheck);
  bb.events.on("thread.idle", recheck);
  bb.events.on("thread.failed", recheck);
  bb.events.on("experimental_thread.events", recheck);
  bb.events.on("thread.archived", ({ thread }) => void ducker.forget(thread.id));
  bb.events.on("thread.deleted", ({ thread }) => void ducker.forget(thread.id));

  bb.http.route("GET", callbackPath, async (context) => {
    const query = (name: string) => context.req.query(name) ?? null;
    const result = await service.authCallback({ code: query("code"), state: query("state"), error: query("error") });
    return context.html(callbackPage(result.ok, result.message), result.ok ? 200 : 400);
  });

  bb.rpc.register(rpcContract, {
    auth_status: () => service.authStatus(),
    auth_start: async () => ({ url: await service.authStart() }),
    auth_disconnect: () => {
      service.disconnect();
      return service.authStatus();
    },
    player_get: ({ fresh }) => service.playerState(fresh),
    player_command: (command) => service.command(command),
    player_play: (request) => service.play(request),
    devices_list: async () => ({ devices: await service.devices() }),
    app_launch: async () => ({ launched: await service.launchApp() }),
    library_playlists: async ({ refresh }) => ({ playlists: await service.playlists(refresh) }),
    library_tracks: ({ playlistId }) => service.tracks(playlistId),
    search: ({ query }) => service.search(query),
    queue_get: async () => ({ tracks: await service.queue() }),
    queue_add: async ({ uri }) => {
      await service.queueAdd(uri);
      return { ok: true };
    },
    shuffle_options_get: () => service.shuffleOptions(),
    shuffle_start: (options) => service.startShuffle(options),
    shuffle_session_get: () => service.shuffleSession(),
    stats_get: () => service.stats(),
    history_recent: ({ limit }) => ({ plays: service.recentPlays(limit) }),
    art_get: async ({ url }) => ({ dataUrl: await service.artData(url) }),
    appearance_set: async ({ skin, palette }) => {
      if (!(PALETTES[skin] as readonly string[]).includes(palette)) throw new Error(`${SKIN_NAMES[skin]} has no palette named ${palette}.`);
      await settings.experimental_set({ skin, [PALETTE_SETTING[skin]]: palette });
      return { skin, palette };
    },
  });

  bb.rpc.register(
    launcherContract,
    {
      "launcher.search": async ({ query }) => ({ items: await service.launcherSearch(query) }),
      "launcher.run": ({ itemId, actionId }) => service.launcherRun(itemId, actionId),
    },
    { experimental_discoverable: true, experimental_description: "Spotify songs, playlists, and playback commands for the Launcher." },
  );

  bb.ui.registerMentionProvider({
    id: "track",
    label: "Spotify songs",
    search: ({ query }) => service.mentionSearch(query),
    resolve: (itemId) => ({ context: service.mentionContext(itemId) }),
  });

  bb.background.service("player", {
    start: (signal) =>
      service.run(signal, async () => {
        if (ducker.tracking()) await ducker.reconcile();
      }),
  });

  bb.background.schedule("backfill", "*/20 * * * *", async () => {
    await service.backfill();
  });

  settings.onChange((next, previous) => {
    if (next.clientId !== previous.clientId) bb.realtime.publish(CHANNELS.auth, null);
  });
}
