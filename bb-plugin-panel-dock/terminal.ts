import { toast } from "sonner";
import type { BbNavigate, PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";

export interface Surface {
  sdk: PluginBrowserBbSdk;
  navigate: BbNavigate;
}

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
}

export function openNewTerminal(surface: Surface, threadId: string) {
  return createTerminal(surface, threadId).catch(reportError);
}
