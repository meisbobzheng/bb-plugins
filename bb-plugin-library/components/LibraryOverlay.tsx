import { useEffect, useState } from "react";
import { experimental_usePluginId, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { LIBRARY_PANEL } from "../library";
import { saveRequests, toggleRequests, type SaveRequest } from "./requests";
import { SaveDialog } from "./SaveDialog";
import { isLibraryVisible, lastEntry } from "./session";

export function LibraryOverlay() {
  const navigate = useBbNavigate();
  const pluginId = experimental_usePluginId();
  const [request, setRequest] = useState<{ key: number; value: SaveRequest } | null>(null);

  useEffect(() => saveRequests.subscribe((value) => setRequest((current) => ({ key: (current?.key ?? 0) + 1, value }))), []);
  useEffect(
    () =>
      toggleRequests.subscribe(() => {
        if (!isLibraryVisible()) {
          const last = lastEntry(pluginId);
          navigate.toPluginPanel(LIBRARY_PANEL, last === null ? undefined : { subPath: last });
        } else if (window.history.length > 1) {
          window.history.back();
        } else {
          navigate.toCompose();
        }
      }),
    [navigate, pluginId],
  );

  return request === null ? null : <SaveDialog key={request.key} request={request.value} onClose={() => setRequest(null)} />;
}
