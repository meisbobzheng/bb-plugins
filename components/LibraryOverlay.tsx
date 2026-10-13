import { useEffect, useState } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { LIBRARY_PANEL } from "../library";
import { openRequests, saveRequests, type SaveRequest } from "./requests";
import { SaveDialog } from "./SaveDialog";

export function LibraryOverlay() {
  const navigate = useBbNavigate();
  const [request, setRequest] = useState<{ key: number; value: SaveRequest } | null>(null);

  useEffect(() => saveRequests.subscribe((value) => setRequest((current) => ({ key: (current?.key ?? 0) + 1, value }))), []);
  useEffect(() => openRequests.subscribe(() => navigate.toPluginPanel(LIBRARY_PANEL)), [navigate]);

  return request === null ? null : <SaveDialog key={request.key} request={request.value} onClose={() => setRequest(null)} />;
}
