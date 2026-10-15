import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { LibraryPage, ThreadLibraryPanel } from "./components/Library";
import { LibraryOverlay } from "./components/LibraryOverlay";
import { saveRequests, toggleRequests } from "./components/requests";
import { LIBRARY_PANEL } from "./library";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: LIBRARY_PANEL,
    title: "Library",
    icon: "Layers",
    path: LIBRARY_PANEL,
    component: LibraryPage,
  });
  app.slots.threadPanelAction({
    id: "library",
    title: "Library",
    component: ThreadLibraryPanel,
    layout: "flush",
  });
  app.slots.experimental_appOverlay({ id: "save-dialog", component: LibraryOverlay });
  app.slots.messageAction({
    id: "save",
    title: "Save to Library",
    run: ({ threadId, message, selectedText }) => {
      const text = (selectedText ?? message.text).trim();
      if (text === "") {
        toast.error("This message has no text to save.");
        return;
      }
      if (!saveRequests.emit({ threadId, messageId: message.id, text })) {
        toast.error("The Library is still loading. Try again in a moment.");
      }
    },
  });
  app.commands.register({
    id: "toggle",
    title: "Library: open your last entry, or go back",
    defaultShortcut: { key: "l", mod: true, shift: true },
    run: () => {
      toggleRequests.emit(null);
    },
  });
});
