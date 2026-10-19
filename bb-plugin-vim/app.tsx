import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { VimOverlay } from "./vim/Overlay";
import { vim } from "./vim/store";

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "vim", component: VimOverlay });

  app.commands.register({
    id: "toggle",
    title: "Vim: pause or resume",
    run: vim.togglePaused,
  });

  app.commands.register({
    id: "help",
    title: "Vim: show keys",
    run: () => vim.set({ help: true }),
  });
});
