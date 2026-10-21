import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { DatabasePage } from "./components/Database";
import { DatabaseHeader } from "./components/Header";
import { HistoryTab } from "./components/HistoryTab";
import { SavedTab } from "./components/SavedTab";
import { DATABASE_PANEL, HISTORY_TAB, SAVED_TAB } from "./panel";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: DATABASE_PANEL,
    title: "Database",
    icon: "database/database",
    path: DATABASE_PANEL,
    component: DatabasePage,
    headerContent: DatabaseHeader,
    fixedTabs: [
      { ...HISTORY_TAB, title: "History", icon: "Clock", component: HistoryTab, layout: "flush" },
      { ...SAVED_TAB, title: "Saved", icon: "Star", component: SavedTab, layout: "flush" },
    ],
  });
});
