// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { IDLE_DUCK, type AuthStatus, type PlayerState, type RpcContract } from "./contract";
import { track } from "./test/fake-spotify";
import { mini } from "./ui/bridge";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
});

afterEach(() => {
  act(() => mini.set(false));
  cleanup();
});

const NOW = track("now", { name: "Let It Happen", artist: "Tame Impala", durationMs: 467_000 });
const OTHER = track("other", { name: "Kerala", artist: "Bonobo" });

const PLAYER: PlayerState = {
  status: "ok",
  error: null,
  fetchedAt: Date.now(),
  isPlaying: false,
  progressMs: 192_000,
  track: NOW,
  device: { id: "mac", name: "MacBook Pro", type: "Computer", isActive: true, volumePercent: 42, supportsVolume: true },
  shuffle: false,
  repeat: "off",
  context: { uri: "spotify:playlist:p1", kind: "playlist", name: "Deep Work" },
  liked: true,
  duck: IDLE_DUCK,
};

const CONNECTED: AuthStatus = { clientIdSet: true, redirectUri: "http://127.0.0.1:38886/api/v1/plugins/spotify/http/callback", connected: true, user: { id: "bob", name: "Bob" } };

async function renderPage(auth: AuthStatus = CONNECTED) {
  const app = await loadPluginApp(() => import("./app"));
  const panel = app.navPanels[0]!;
  const commands: unknown[] = [];
  const slot = renderSlot<{ subPath: string }, RpcContract>(panel, { subPath: "" }, {
    settings: { skin: "console", consolePalette: "cape" },
    rpc: {
      auth_status: () => auth,
      player_get: () => PLAYER,
      player_command: (input) => {
        commands.push(input);
        return PLAYER;
      },
      library_playlists: () => ({
        playlists: [
          { id: "liked", uri: "spotify:user:bob:collection", name: "Liked Songs", owner: "you", ownedByMe: true, collaborative: false, readable: true, trackCount: 2, imageUrl: null, url: null, kind: "liked" },
          { id: "p1", uri: "spotify:playlist:p1", name: "Deep Work", owner: "you", ownedByMe: true, collaborative: false, readable: true, trackCount: 2, imageUrl: null, url: null, kind: "playlist" },
          { id: "p2", uri: "spotify:playlist:p2", name: "Lo-fi Beats", owner: "Spotify", ownedByMe: false, collaborative: false, readable: false, trackCount: 300, imageUrl: null, url: null, kind: "playlist" },
        ],
      }),
      library_tracks: () => ({ tracks: [NOW, OTHER], readable: true }),
      shuffle_session_get: () => null,
      shuffle_options_get: () => null,
      stats_get: () => ({ since: null, listenedMs7: 0, listenedMs30: 0, plays30: 0, skipRate30: null, topArtists: [], topTracks: [], byHour: new Array(24).fill(0), byWeekday: new Array(7).fill(0), forgotten: [] }),
      history_recent: () => ({ plays: [] }),
      queue_get: () => ({ tracks: [OTHER] }),
      art_get: () => ({ dataUrl: "data:image/png;base64," }),
      auth_start: () => ({ url: "https://accounts.spotify.com/authorize" }),
      auth_disconnect: () => ({ ...auth, connected: false, user: null }),
      player_play: () => PLAYER,
      devices_list: () => ({ devices: [] }),
      app_launch: () => ({ launched: true }),
      search: () => ({ tracks: [], playlists: [], artists: [], albums: [] }),
      queue_add: () => ({ ok: true }),
      shuffle_start: () => {
        throw new Error("not in this test");
      },
      appearance_set: (input) => input,
    },
  });
  return { slot, commands };
}

describe("spotify app", () => {
  it("registers the page, the mini player, and the composer mention", async () => {
    const app = await loadPluginApp(() => import("./app"));
    expect(app.navPanels.map((panel) => panel.path)).toEqual(["spotify"]);
    expect(app.appOverlays).toHaveLength(1);
    expect(app.composerCustomizations[0]?.plusMenu?.map((item) => item.id)).toEqual(["mention"]);
    expect(app.experimentalSidebarFooterItems).toHaveLength(1);
  });

  it("walks through connecting when Spotify is not linked", async () => {
    const { slot } = await renderPage({ ...CONNECTED, connected: false, user: null });
    await slot.findByText("Connect Spotify", { selector: "h2" });
    expect(slot.getByText(CONNECTED.redirectUri)).toBeTruthy();
  });

  it("shows the song, the playlists, and drives playback from the keyboard and :commands", async () => {
    const { slot, commands } = await renderPage();
    await slot.findByText("Let It Happen", { selector: ".c-title" });
    await slot.findByText("Lo-fi Beats");
    expect(slot.getByText("── followed · play only")).toBeTruthy();
    await slot.findByText("Kerala", { selector: "td" });
    const root = slot.container.querySelector(".sp-console") as HTMLElement;
    fireEvent.keyDown(root, { key: " " });
    await waitFor(() => expect(commands).toContainEqual({ kind: "toggle" }));
    fireEvent.keyDown(root, { key: ":" });
    const input = await slot.findByRole("textbox", { name: "Command" });
    fireEvent.change(input, { target: { value: ":vol 30" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(commands).toContainEqual({ kind: "volume", percent: 30 }));
  });

  it("plays a song from the selected playlist on Enter", async () => {
    const { slot } = await renderPage();
    await slot.findByText("Kerala", { selector: "td" });
    const root = slot.container.querySelector(".sp-console") as HTMLElement;
    fireEvent.keyDown(root, { key: "j" });
    fireEvent.keyDown(root, { key: "Enter" });
    await waitFor(() =>
      expect(slot.inspection.rpcCalls).toContainEqual(expect.objectContaining({ method: "player_play", input: { contextUri: "spotify:playlist:p1", uris: null, offsetUri: OTHER.uri } })),
    );
  });

  it("folds into one tabbed pane with clickable transport in a small window", async () => {
    const size = (axis: "clientWidth" | "clientHeight", value: number) =>
      Object.defineProperty(HTMLElement.prototype, axis, {
        configurable: true,
        get(this: HTMLElement) {
          return this.classList.contains("sp-console") ? value : 0;
        },
      });
    size("clientWidth", 480);
    size("clientHeight", 360);
    try {
      const { slot, commands } = await renderPage();
      await slot.findByText("Kerala", { selector: "td" });
      expect(slot.container.querySelector(".sp-console")?.getAttribute("data-layout")).toBe("stack");
      expect(slot.queryByText("Lo-fi Beats")).toBeNull();
      fireEvent.click(slot.getByRole("button", { name: "Play" }));
      await waitFor(() => expect(commands).toContainEqual({ kind: "toggle" }));
      fireEvent.click(slot.getByRole("tab", { name: "[1] playlists" }));
      await slot.findByText("Lo-fi Beats");
      fireEvent.click(slot.getByText("Deep Work"));
      await slot.findByText("Kerala", { selector: "td" });
      expect(slot.getByRole("tab", { name: "[2] tracks" }).getAttribute("aria-selected")).toBe("true");
      fireEvent.click(slot.getByRole("tab", { name: "[6] up next" }));
      await slot.findByText(/queue is empty|Kerala/);
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
      Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
    }
  });
});
