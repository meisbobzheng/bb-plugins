import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { AtlasPage } from "./components/AtlasPage";
import { PANEL_PATH } from "./constants";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "atlas",
    title: "Atlas",
    icon: "Layers",
    path: PANEL_PATH,
    component: AtlasPage,
  });
});
