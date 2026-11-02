import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { ThreadSidebar } from "./sidebar/ThreadSidebar";

export default definePluginApp((app) => {
  app.slots.experimental_threadList({
    id: "thread-sidebar",
    title: "Thread Sidebar",
    description: "Threads grouped by project, with the ones waiting on you highlighted and listed first.",
    component: ThreadSidebar,
  });
});
