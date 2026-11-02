export const SOUNDS = ["None", "Basso", "Blow", "Bottle", "Frog", "Funk", "Glass", "Hero", "Morse", "Ping", "Pop", "Purr", "Sosumi", "Submarine", "Tink"];

export const EVENTS = ["input", "finished", "failed"] as const;

export type ChimeEvent = (typeof EVENTS)[number];

export const EVENT_LABELS: Record<ChimeEvent, string> = { input: "Needs input", finished: "Thread finished", failed: "Thread failed" };

const FREEDESKTOP: Record<ChimeEvent, string> = { input: "message-new-instant", finished: "complete", failed: "dialog-error" };

export const COALESCE_MS = 2_000;

export interface System {
  platform: NodeJS.Platform;
  run(command: string, args: readonly string[]): Promise<void>;
  exists(path: string): boolean;
}

export interface ChimeOptions extends System {
  settings(): Promise<{ sounds: Record<ChimeEvent, string>; volumePercent: number }>;
  now(): number;
  log(message: string): void;
}

type Command = readonly [string, readonly string[]];

export function commands(platform: NodeJS.Platform, event: ChimeEvent, sound: string, volume: number, exists: (path: string) => boolean): Command[] {
  if (platform === "darwin") return [["afplay", ["-v", String(volume), `/System/Library/Sounds/${sound}.aiff`]]];
  const file = `/usr/share/sounds/freedesktop/stereo/${FREEDESKTOP[event]}.oga`;
  if (platform !== "linux" || !exists(file)) return [];
  return [
    ["paplay", [`--volume=${Math.round(volume * 65536)}`, file]],
    ["aplay", ["-q", file]],
  ];
}

export function createChime(options: ChimeOptions) {
  const last = new Map<ChimeEvent, number>();
  let warned = false;

  async function play(event: ChimeEvent): Promise<string | null> {
    const settings = await options.settings();
    const sound = settings.sounds[event];
    const volume = settings.volumePercent / 100;
    if (sound === "None" || volume === 0) return null;
    const candidates = commands(options.platform, event, sound, volume, options.exists);
    if (candidates.length === 0) throw new Error(`no sound player on ${options.platform}`);
    let failure: unknown;
    for (const [command, args] of candidates) {
      try {
        await options.run(command, args);
        return sound;
      } catch (error) {
        failure = error;
      }
    }
    throw failure;
  }

  return {
    play,
    async notify(event: ChimeEvent) {
      const at = options.now();
      if (at - (last.get(event) ?? -Infinity) < COALESCE_MS) return;
      last.set(event, at);
      try {
        await play(event);
      } catch (error) {
        if (warned) return;
        warned = true;
        options.log(`chime: can't play sounds: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}
