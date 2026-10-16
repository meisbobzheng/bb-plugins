import { definePluginApp, type PluginComposerApi } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { ScratchpadOverlay } from "./scratchpad/Overlay";
import { scratchpad } from "./scratchpad/store";

const MENTION_PROVIDER = "board";

function mentionActiveBoard(composer: PluginComposerApi) {
  const board = scratchpad.get().activeBoard;
  if (board === null) {
    toast.info("Open the scratchpad and pick a board first.");
    return;
  }
  composer.insert([{ provider: MENTION_PROVIDER, id: board.id, label: board.name }, " "]);
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "scratchpad", component: ScratchpadOverlay });

  app.commands.register({
    id: "toggle",
    title: "Scratchpad: show or hide",
    defaultShortcut: { key: "j", mod: true, shift: true },
    run: scratchpad.toggle,
  });

  app.composer.experimental_registerCommand({
    id: "mention-board",
    title: "Scratchpad: mention the current board",
    run: ({ composer }) => mentionActiveBoard(composer),
  });

  app.composer.customize({
    id: "scratchpad",
    plusMenu: [
      {
        id: "mention-board",
        label: "Mention scratchpad board",
        description: "Attach the board you last opened in the scratchpad",
        disabled: () => scratchpad.get().activeBoard === null,
        run: ({ composer }) => mentionActiveBoard(composer),
      },
    ],
  });

  app.experimental_sidebarFooter.register({
    kind: "action",
    id: "toggle",
    label: "Scratchpad",
    icon: "StickyNote",
    onActivate: scratchpad.toggle,
  });
});
