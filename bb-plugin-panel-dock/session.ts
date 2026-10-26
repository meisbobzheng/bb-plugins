import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";

export interface Place {
  threadId: string | null;
  projectId: string | null;
}

export type TerminalScope = Parameters<
  PluginBrowserBbSdk["terminals"]["create"]
>[0]["scope"];

export interface TerminalSink {
  write(data: Uint8Array): void;
  exit(exitCode: number | null): void;
}

export interface Session {
  send(data: string): void;
  resize(cols: number, rows: number): void;
  setVisible(visible: boolean): void;
  close(): Promise<void>;
  dispose(): void;
}

export const FAST_POLL_MS = 16;
export const IDLE_POLL_MS = 250;
export const HIDDEN_POLL_MS = 1000;
const INPUT_CHUNK = 4096;

export async function resolveScope(
  sdk: PluginBrowserBbSdk,
  { threadId, projectId }: Place,
): Promise<TerminalScope> {
  if (threadId) return { kind: "thread", threadId };
  if (projectId) {
    const environments = await sdk.environments.list({ projectId });
    const checkout =
      environments.find((environment) => !environment.isWorktree && environment.path) ??
      environments[0];
    if (checkout) return { kind: "environment", environmentId: checkout.id };
  }
  const hosts = await sdk.hosts.list();
  const host =
    hosts.find((candidate) => candidate.machineProviderId === null && candidate.status === "connected") ??
    hosts[0];
  if (!host) throw new Error("No machine is connected to open a terminal on");
  return { kind: "host_path", hostId: host.id, cwd: null };
}

const decode = (base64: string) =>
  Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

function encode(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function startSession(
  sdk: PluginBrowserBbSdk,
  terminalId: string,
  sink: TerminalSink,
): Session {
  const controller = new AbortController();
  const { signal } = controller;
  let nextSeq: number | undefined;
  let delay = FAST_POLL_MS;
  let visible = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sending = Promise.resolve();

  const schedule = (ms: number) => {
    clearTimeout(timer);
    if (!signal.aborted) timer = setTimeout(poll, ms);
  };

  async function poll() {
    try {
      const output = await sdk.terminals.output({ terminalId, sinceSeq: nextSeq, signal });
      for (const chunk of output.chunks) sink.write(decode(chunk.dataBase64));
      nextSeq = output.nextSeq;
      if (output.status === "exited") {
        sink.exit(output.exitCode);
        return;
      }
      delay = output.chunks.length > 0 ? FAST_POLL_MS : Math.min(delay * 2, IDLE_POLL_MS);
    } catch {
      if (signal.aborted) return;
      delay = IDLE_POLL_MS;
    }
    schedule(visible ? delay : HIDDEN_POLL_MS);
  }

  schedule(0);

  return {
    send(data) {
      const bytes = new TextEncoder().encode(data);
      for (let start = 0; start < bytes.length; start += INPUT_CHUNK) {
        const dataBase64 = encode(bytes.subarray(start, start + INPUT_CHUNK));
        sending = sending
          .then(() => sdk.terminals.input({ terminalId, dataBase64 }))
          .then(() => undefined, () => undefined);
      }
      delay = FAST_POLL_MS;
      schedule(FAST_POLL_MS);
    },
    resize(cols, rows) {
      sdk.terminals.resize({ terminalId, cols, rows }).catch(() => undefined);
    },
    setVisible(next) {
      visible = next;
      if (visible) schedule(0);
    },
    async close() {
      controller.abort();
      clearTimeout(timer);
      await sdk.terminals.close({ terminalId, mode: "force" });
    },
    dispose() {
      controller.abort();
      clearTimeout(timer);
    },
  };
}
