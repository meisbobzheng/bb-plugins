import { definePluginApp, useComposer } from "@get-bb/plugin-sdk/app";
import { useThreadMeter } from "./hooks";
import { ThreadMeterView } from "./meter";

function ThreadMeter() {
  const { scope, selection } = useComposer();
  const data = useThreadMeter({
    threadId: scope.kind === "thread" ? scope.threadId : null,
    providerId: selection?.providerId,
    model: selection?.model,
  });
  return <ThreadMeterView {...data} />;
}

export default definePluginApp((app) => {
  app.composer.customize({
    id: "thread-meter",
    scopes: ["thread", "new-thread"],
    actions: [{ id: "meter", component: ThreadMeter }],
  });
});
