import { useEffect, useSyncExternalStore } from "react";
import { useComposers, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { CHANNELS, playerStateSchema, type PlayerCommand, type PlayerState, type RpcContract } from "../contract";
import { errorMessage } from "./data";
import { copyLink, mention, setComposers } from "./share";

type Rpc = ReturnType<typeof useRpc<RpcContract>>;

let rpc: Rpc | null = null;
let player: PlayerState | null = null;
let miniOpen = false;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

export const mini = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get: () => miniOpen,
  set(open: boolean) {
    miniOpen = open;
    emit();
  },
  toggle() {
    mini.set(!miniOpen);
  },
};

export function useMiniOpen(): boolean {
  return useSyncExternalStore(mini.subscribe, mini.get, mini.get);
}

export function Bridge() {
  const client = useRpc<RpcContract>();
  const composers = useComposers();
  useEffect(() => {
    rpc = client;
    void client.call("player_get", { fresh: false }).then((state) => (player = state), () => undefined);
  }, [client]);
  useEffect(() => setComposers(composers), [composers]);
  useRealtime(CHANNELS.player, (payload) => {
    const parsed = playerStateSchema.safeParse(payload);
    if (parsed.success) player = parsed.data;
  });
  return null;
}

function connected(): Rpc | null {
  if (rpc === null) toast.error("Spotify is still loading.");
  return rpc;
}

export function runCommand(input: PlayerCommand, done?: (state: PlayerState) => string | null) {
  const client = connected();
  if (client === null) return;
  void client.call("player_command", input).then(
    (state) => {
      player = state;
      const note = done?.(state);
      if (note) toast.success(note);
    },
    (cause: unknown) => toast.error(errorMessage(cause)),
  );
}

export function currentTrack() {
  const track = player?.track ?? null;
  if (track === null) toast.info("Nothing is playing on Spotify.");
  return track;
}

export const commands = {
  toggle: () => runCommand({ kind: "toggle" }),
  next: () => runCommand({ kind: "next" }),
  previous: () => runCommand({ kind: "previous" }),
  like: () => runCommand({ kind: "like", liked: !(player?.liked ?? false) }, (state) => (state.liked ? "Saved to Liked Songs" : "Removed from Liked Songs")),
  copyLink: () => {
    const track = currentTrack();
    if (track !== null) void copyLink(track);
  },
  mention: () => {
    const track = currentTrack();
    if (track !== null) void mention(track);
  },
};
