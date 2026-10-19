import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { LauncherOverlay } from "./launcher/Launcher";
import { launcher } from "./launcher/store";

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "launcher", component: LauncherOverlay });

  app.commands.register({
    id: "open",
    title: "Launcher: open",
    run: launcher.open,
  });
});
