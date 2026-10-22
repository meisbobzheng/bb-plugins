import { useEffect, useSyncExternalStore } from "react";
import {
  definePluginApp,
  useBbNavigate,
  useSdk,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
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
import {
  endFloat,
  floatingThreadId,
  getDock,
  mountDock,
  parseDock,
  setDock,
  showPanel,
  subscribeDock,
} from "./dock";
import { openNewTerminal, surfaces, toggleFloatingTerminal } from "./terminal";
import "./dock.css";

export function PanelDockMenu({
  threadId,
  isCompactViewport,
}: PluginThreadHeaderActionProps) {
  const dock = useSyncExternalStore(subscribeDock, getDock);
  const sdk = useSdk();
  const navigate = useBbNavigate();

  useEffect(() => {
    surfaces.set(threadId, { sdk, navigate });
  });
  useEffect(
    () => () => {
      surfaces.delete(threadId);
      if (floatingThreadId() === threadId) endFloat({ hide: false });
    },
    [threadId],
  );

  if (isCompactViewport) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          aria-label="Panel position and terminal"
        >
          <Icon name={dock === "bottom" ? "PanelBottom" : "PanelRight"} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuLabel>Open panel</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={dock}
          onValueChange={(value) => {
            setDock(parseDock(value));
            showPanel();
          }}
        >
          <DropdownMenuRadioItem value="right">On the right</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="bottom">At the bottom</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => openNewTerminal({ sdk, navigate }, threadId)}>
          <Icon name="Terminal" />
          New terminal
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => toggleFloatingTerminal(threadId)}>
          <Icon name="AppWindow" />
          Floating terminal
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default definePluginApp((app) => {
  app.contentScripts.register({ id: "dock", mount: mountDock });
  app.slots.experimental_threadHeaderAction({
    id: "panel-dock",
    title: "Panel dock",
    component: PanelDockMenu,
  });
  app.commands.register({
    id: "toggle-dock",
    title: "Move panel between right and bottom",
    run: () => setDock(getDock() === "bottom" ? "right" : "bottom"),
  });
  app.commands.register({
    id: "floating-terminal",
    title: "Toggle floating terminal",
    defaultShortcut: { key: "`", control: true },
    isAvailable: ({ threadId }) => threadId !== null && surfaces.has(threadId),
    run: ({ threadId }) => {
      if (threadId) return toggleFloatingTerminal(threadId);
    },
  });
});
