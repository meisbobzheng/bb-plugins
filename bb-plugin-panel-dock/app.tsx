import { useSyncExternalStore } from "react";
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
import { floating } from "./floating";
import { FloatingTerminal } from "./FloatingTerminal";
import { openNewTerminal } from "./terminal";
import "./dock.css";

export function PanelDockMenu({
  threadId,
  projectId,
  isCompactViewport,
}: PluginThreadHeaderActionProps) {
  const dock = useSyncExternalStore(subscribeDock, getDock);
  const sdk = useSdk();
  const navigate = useBbNavigate();

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
        <DropdownMenuItem onSelect={() => floating.toggle({ threadId, projectId })}>
          <Icon name="AppWindow" />
          Floating terminal
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default definePluginApp((app) => {
  app.contentScripts.register({ id: "dock", mount: mountDock });
  app.slots.experimental_appOverlay({ id: "floating-terminal", component: FloatingTerminal });
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
    run: ({ threadId, projectId }) => floating.toggle({ threadId, projectId }),
  });
  app.experimental_sidebarFooter.register({
    kind: "action",
    id: "floating-terminal",
    label: "Floating terminal",
    icon: "Terminal",
    onActivate: () => floating.toggle(),
  });
});
