import { useState } from "react";
import { useRpc, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { PALETTE_NAMES, PALETTES, SKIN_NAMES, SKINS, type Device, type RpcContract, type SkinId } from "../contract";
import { useAppearance } from "./appearance";
import { mini } from "./bridge";
import { errorMessage, useAuth } from "./data";

function AppearanceMenu() {
  const rpc = useRpc<RpcContract>();
  const { skin, palette } = useAppearance();
  const choose = (next: SkinId, nextPalette?: string) =>
    void rpc.call("appearance_set", { skin: next, palette: nextPalette ?? (next === skin ? palette : PALETTES[next][0]) }).catch((cause: unknown) => toast.error(errorMessage(cause)));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="Look and palette">
          <Icon name="Palette" className="size-4" />
          <span className="hidden md:inline">
            {SKIN_NAMES[skin]} · {PALETTE_NAMES[palette] ?? palette}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Look</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={skin} onValueChange={(value) => choose(value as SkinId)}>
          {SKINS.map((id) => (
            <DropdownMenuRadioItem key={id} value={id}>
              {SKIN_NAMES[id]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{SKIN_NAMES[skin]} palette</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={palette} onValueChange={(value) => choose(skin, value)}>
          {PALETTES[skin].map((id) => (
            <DropdownMenuRadioItem key={id} value={id}>
              {PALETTE_NAMES[id] ?? id}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DeviceMenu() {
  const rpc = useRpc<RpcContract>();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const load = () => void rpc.call("devices_list", null).then((result) => setDevices(result.devices), (cause: unknown) => toast.error(errorMessage(cause)));
  const transfer = (device: Device) =>
    device.id !== null &&
    void rpc.call("player_command", { kind: "transfer", deviceId: device.id, play: true }).then(() => toast.success(`Playing on ${device.name}`), (cause: unknown) => toast.error(errorMessage(cause)));
  const active = devices?.find((device) => device.isActive);
  return (
    <DropdownMenu onOpenChange={(open) => open && load()}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="Playback device">
          <Icon name="spotify/speaker" className="size-4" />
          <span className="hidden max-w-40 truncate md:inline">{active?.name ?? "Device"}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Play on</DropdownMenuLabel>
        {devices === null ? <DropdownMenuItem disabled>Looking for devices…</DropdownMenuItem> : null}
        {devices?.length === 0 ? <DropdownMenuItem disabled>No Spotify app is open</DropdownMenuItem> : null}
        {devices?.map((device) => (
          <DropdownMenuItem key={device.id ?? device.name} onSelect={() => transfer(device)}>
            {device.isActive ? "● " : ""}
            {device.name}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() =>
            void rpc.call("app_launch", null).then(({ launched }) => (launched ? toast.success("Opening Spotify…") : toast.error("Could not open the Spotify app.")), (cause: unknown) => toast.error(errorMessage(cause)))
          }
        >
          Open the Spotify app
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SpotifyHeader(_props: PluginNavPanelProps) {
  const { auth } = useAuth();
  return (
    <div className="flex items-center gap-1">
      {auth?.connected ? <DeviceMenu /> : null}
      <AppearanceMenu />
      <Button variant="ghost" size="sm" onClick={mini.toggle} aria-label="Toggle the mini player">
        <Icon name="spotify/mini" className="size-4" />
        <span className="hidden md:inline">Mini</span>
      </Button>
    </div>
  );
}
