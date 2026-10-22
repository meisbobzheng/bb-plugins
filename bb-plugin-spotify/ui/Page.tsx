import { useSyncExternalStore } from "react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { PALETTES, SKINS, type SkinId } from "../contract";
import { useAppearance } from "./appearance";
import { ConnectPage } from "./Connect";
import { useAuth, useSpotify } from "./data";
import { SKIN_COMPONENTS } from "./skins";

let previewing = false;
const previewListeners = new Set<() => void>();

export const preview = {
  subscribe(listener: () => void) {
    previewListeners.add(listener);
    return () => previewListeners.delete(listener);
  },
  get: () => previewing,
  set(value: boolean) {
    previewing = value;
    previewListeners.forEach((listener) => listener());
  },
};

export function usePreview(): boolean {
  return useSyncExternalStore(preview.subscribe, preview.get, preview.get);
}

export function SpotifyPage({ subPath }: PluginNavPanelProps) {
  const { auth } = useAuth();
  const [route, skin, palette] = subPath.split("/");
  const forced = route === "preview" ? { skin: SKINS.find((id) => id === skin), palette } : null;
  const previewOn = usePreview() || forced !== null;
  if (auth === null) return <div className="p-5 text-sm text-muted-foreground">Loading Spotify…</div>;
  if (!auth.connected && !previewOn) return <ConnectPage auth={auth} onPreview={() => preview.set(true)} />;
  return <Player preview={!auth.connected || forced !== null} forcedSkin={forced?.skin} forcedPalette={forced?.palette} />;
}

function Notice({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-4 py-2 text-sm">
      <span className="min-w-0">{children}</span>
      {action}
    </div>
  );
}

function Player({ preview: isPreview, forcedSkin, forcedPalette }: { preview: boolean; forcedSkin?: SkinId; forcedPalette?: string }) {
  const appearance = useAppearance();
  const skin = forcedSkin ?? appearance.skin;
  const options: readonly string[] = PALETTES[skin];
  const palette = forcedPalette !== undefined && options.includes(forcedPalette) ? forcedPalette : forcedSkin === undefined ? appearance.palette : options[0]!;
  const { data, actions } = useSpotify("page", isPreview);
  const Skin = SKIN_COMPONENTS[skin];
  const { player } = data;
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {isPreview ? (
        <Notice action={<Button size="sm" variant="outline" onClick={() => preview.set(false)}>Connect Spotify</Button>}>
          Previewing with sample songs. Switch looks and palettes from the header.
        </Notice>
      ) : null}
      {!isPreview && player.status === "error" && player.error ? <Notice>{player.error}</Notice> : null}
      <div className="relative min-h-0 flex-1">
        <Skin.Page data={data} actions={actions} palette={palette} />
      </div>
    </div>
  );
}
