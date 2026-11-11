import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { TravelKitPage } from "./components/TravelKit";
import { TRAVEL_KIT_PANEL } from "./kit";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: TRAVEL_KIT_PANEL,
    title: "Travel Kit",
    icon: "Briefcase",
    path: TRAVEL_KIT_PANEL,
    component: TravelKitPage,
  });
});
