import type { DuckState } from "./contract";

export type DuckMode = DuckState["mode"];

export interface DuckPlayer {
  snapshot(): Promise<{ isPlaying: boolean; volumePercent: number | null; trackId: string | null } | null>;
  setVolume(percent: number): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
}

export interface DuckerOptions {
  settings(): Promise<{ mode: DuckMode; volumePercent: number }>;
  player: DuckPlayer;
  isPending(threadId: string): Promise<boolean>;
  onChange(state: DuckState): void;
  log(message: string): void;
}

type Applied = { kind: "lower"; priorVolume: number; duckedVolume: number } | { kind: "pause"; trackId: string | null };

export function createDucker(options: DuckerOptions) {
  const waiting = new Map<string, string>();
  let applied: Applied | null = null;
  let mode: DuckMode = "off";
  let queue: Promise<unknown> = Promise.resolve();

  const state = (): DuckState => ({ active: applied !== null, mode, threads: [...waiting].map(([id, title]) => ({ id, title })) });
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work);
    queue = next.catch((error: unknown) => options.log(`duck: ${error instanceof Error ? error.message : String(error)}`));
    return next;
  };

  async function apply() {
    if (applied !== null || waiting.size === 0) return;
    const settings = await options.settings();
    mode = settings.mode;
    if (settings.mode === "off") return;
    const snapshot = await options.player.snapshot();
    if (snapshot === null || !snapshot.isPlaying) return;
    if (settings.mode === "lower" && snapshot.volumePercent !== null && snapshot.volumePercent > settings.volumePercent) {
      await options.player.setVolume(settings.volumePercent);
      applied = { kind: "lower", priorVolume: snapshot.volumePercent, duckedVolume: settings.volumePercent };
    } else if (settings.mode === "pause" || snapshot.volumePercent === null) {
      await options.player.pause();
      applied = { kind: "pause", trackId: snapshot.trackId };
    }
  }

  async function restore() {
    if (applied === null) return;
    const was = applied;
    applied = null;
    const snapshot = await options.player.snapshot();
    if (snapshot === null) return;
    if (was.kind === "lower" && snapshot.volumePercent === was.duckedVolume) await options.player.setVolume(was.priorVolume);
    if (was.kind === "pause" && !snapshot.isPlaying && snapshot.trackId === was.trackId) await options.player.resume();
  }

  return {
    state,
    pending(threadId: string, title: string) {
      return serial(async () => {
        waiting.set(threadId, title);
        await apply();
        options.onChange(state());
      });
    },
    reconcile(threadIds?: readonly string[]) {
      return serial(async () => {
        const targets = threadIds?.filter((id) => waiting.has(id)) ?? [...waiting.keys()];
        if (targets.length === 0 && waiting.size > 0) return;
        for (const id of targets) if (!(await options.isPending(id).catch(() => false))) waiting.delete(id);
        if (waiting.size === 0) await restore();
        options.onChange(state());
      });
    },
    forget(threadId: string) {
      return serial(async () => {
        waiting.delete(threadId);
        if (waiting.size === 0) await restore();
        options.onChange(state());
      });
    },
    tracking: () => waiting.size > 0,
  };
}

export type Ducker = ReturnType<typeof createDucker>;
