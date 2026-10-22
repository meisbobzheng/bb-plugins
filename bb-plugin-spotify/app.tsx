import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { commands, mini } from "./ui/bridge";
import { SettingsSection } from "./ui/Connect";
import { PANEL_PATH } from "./ui/data";
import { SpotifyHeader } from "./ui/Header";
import { SpotifyOverlay } from "./ui/Overlay";
import { SpotifyPage } from "./ui/Page";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: PANEL_PATH,
    title: "Spotify",
    icon: "spotify/note",
    path: PANEL_PATH,
    component: SpotifyPage,
    headerContent: SpotifyHeader,
  });

  app.slots.experimental_appOverlay({ id: "mini", component: SpotifyOverlay });

  app.slots.settingsSection({
    id: "connection",
    title: "Spotify account",
    description: "Connect the Spotify app you registered at developer.spotify.com.",
    component: SettingsSection,
  });

  app.commands.register({ id: "mini", title: "Spotify: show or hide the mini player", defaultShortcut: { key: "s", mod: true, shift: true }, run: mini.toggle });
  app.commands.register({ id: "toggle", title: "Spotify: play or pause", run: commands.toggle });
  app.commands.register({ id: "next", title: "Spotify: next song", run: commands.next });
  app.commands.register({ id: "previous", title: "Spotify: previous song", run: commands.previous });
  app.commands.register({ id: "like", title: "Spotify: save or remove the song from Liked Songs", run: commands.like });
  app.commands.register({ id: "copy-link", title: "Spotify: copy the song link", run: commands.copyLink });

  app.composer.experimental_registerCommand({ id: "mention", title: "Spotify: mention the song that is playing", run: commands.mention });
  app.composer.customize({
    id: "spotify",
    plusMenu: [
      {
        id: "mention",
        label: "Mention the Spotify song",
        description: "Attach the song that is playing, with its link",
        icon: "spotify/note",
        run: commands.mention,
      },
    ],
  });

  app.experimental_sidebarFooter.register({ kind: "action", id: "mini", label: "Spotify mini player", icon: "spotify/mini", onActivate: mini.toggle });
});
