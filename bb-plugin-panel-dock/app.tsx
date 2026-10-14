import { useSyncExternalStore } from "react";
import { toast } from "sonner";
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
  getDock,
  mountDock,
  parseDock,
  setDock,
  showPanel,
  subscribeDock,
} from "./dock";
import "./dock.css";

export function PanelDockMenu({
  threadId,
  isCompactViewport,
}: PluginThreadHeaderActionProps) {
  const dock = useSyncExternalStore(subscribeDock, getDock);
  const sdk = useSdk();
  const navigate = useBbNavigate();
  if (isCompactViewport) return null;

  const openTerminal = async () => {
    try {
      const terminal = await sdk.terminals.create({
        scope: { kind: "thread", threadId },
        cols: 80,
        rows: 24,
      });
      if (!(await navigate.experimental_openTerminal({ terminalId: terminal.id }))) {
        toast.error("Could not show the terminal");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

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
        <DropdownMenuItem onSelect={openTerminal}>
          <Icon name="Terminal" />
          New terminal
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
});
