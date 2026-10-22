import { toast } from "sonner";
import type { BbNavigate, PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";
import { endFloat, floatingThreadId, settleFloat, startFloat } from "./dock";

export interface Surface {
  sdk: PluginBrowserBbSdk;
  navigate: BbNavigate;
}

export const surfaces = new Map<string, Surface>();
const floatingTerminals = new Map<string, string>();

const reportError = (error: unknown) =>
  toast.error(error instanceof Error ? error.message : String(error));

async function createTerminal({ sdk, navigate }: Surface, threadId: string) {
  const terminal = await sdk.terminals.create({
    scope: { kind: "thread", threadId },
    cols: 80,
    rows: 24,
  });
  if (!(await navigate.experimental_openTerminal({ terminalId: terminal.id }))) {
    throw new Error("Could not show the terminal");
  }
  return terminal.id;
}

export function openNewTerminal(surface: Surface, threadId: string) {
  return createTerminal(surface, threadId).catch(reportError);
}

async function showFloatingTerminal(surface: Surface, threadId: string) {
  const terminalId = floatingTerminals.get(threadId);
  if (terminalId && (await surface.navigate.experimental_openTerminal({ terminalId }))) {
    return;
  }
  floatingTerminals.set(threadId, await createTerminal(surface, threadId));
}

export async function toggleFloatingTerminal(threadId: string) {
  if (floatingThreadId() !== null) return endFloat();
  const surface = surfaces.get(threadId);
  if (!surface) return;
  const float = startFloat(threadId);
  try {
    await showFloatingTerminal(surface, threadId);
    settleFloat(float);
  } catch (error) {
    endFloat();
    reportError(error);
  }
}
