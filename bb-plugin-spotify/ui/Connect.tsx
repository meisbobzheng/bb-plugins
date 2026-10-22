import { useState } from "react";
import { experimental_copyToClipboard, useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { AuthStatus, RpcContract } from "../contract";
import { errorMessage, useAuth } from "./data";

const DASHBOARD = "https://developer.spotify.com/dashboard";

export function ConnectSteps({ auth, compact }: { auth: AuthStatus; compact?: boolean }) {
  const rpc = useRpc<RpcContract>();
  const navigate = useBbNavigate();
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    setBusy(true);
    try {
      const { url } = await rpc.call("auth_start", null);
      if (!navigate.openUrl(url)) window.open(url, "_blank", "noopener");
      toast.info("Finish signing in to Spotify in the page that opened.");
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    try {
      await rpc.call("auth_disconnect", null);
      toast.success("Disconnected from Spotify");
    } catch (cause) {
      toast.error(errorMessage(cause));
    }
  };

  const copyRedirect = async () => {
    const ok = await experimental_copyToClipboard({ text: auth.redirectUri });
    ok ? toast.success("Copied the redirect URI") : toast.error("Could not copy");
  };

  if (auth.connected) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span>
          Connected as <span className="font-medium">{auth.user?.name ?? auth.user?.id}</span>.
        </span>
        <Button variant="outline" size="sm" onClick={() => void disconnect()}>
          Disconnect
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      {compact ? null : <p className="text-muted-foreground">Spotify requires each listener to register a free app of their own. It takes about a minute.</p>}
      <ol className="list-decimal space-y-2 pl-5">
        <li>
          Open the{" "}
          <button type="button" className="underline underline-offset-2" onClick={() => navigate.openUrl(DASHBOARD) || window.open(DASHBOARD, "_blank", "noopener")}>
            Spotify developer dashboard
          </button>{" "}
          and create an app. Choose <span className="font-medium">Web API</span>.
        </li>
        <li>
          Add this redirect URI to the app:
          <div className="mt-1 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded border border-border bg-muted px-2 py-1 font-mono text-xs">{auth.redirectUri}</code>
            <Button variant="outline" size="sm" onClick={() => void copyRedirect()}>
              Copy
            </Button>
          </div>
        </li>
        <li>
          Paste the app's <span className="font-medium">Client ID</span> into this plugin's settings{auth.clientIdSet ? " (done)" : ""}.
        </li>
        <li>Connect. Spotify only allows playback control for Premium accounts.</li>
      </ol>
      <Button disabled={!auth.clientIdSet || busy} onClick={() => void connect()}>
        Connect Spotify
      </Button>
    </div>
  );
}

export function ConnectPage({ auth, onPreview }: { auth: AuthStatus; onPreview(): void }) {
  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto box-border w-full max-w-xl space-y-5 px-4 pb-6 pt-6 md:px-5">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Connect Spotify</h2>
          <p className="text-sm text-muted-foreground">Control the Spotify app on this Mac, browse playlists, smart shuffle, and keep a private listening history.</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <ConnectSteps auth={auth} compact />
        </div>
        <Button variant="outline" onClick={onPreview}>
          Preview the looks with sample songs
        </Button>
      </div>
    </div>
  );
}

export function SettingsSection() {
  const { auth } = useAuth();
  return auth === null ? <p className="text-sm text-muted-foreground">Loading…</p> : <ConnectSteps auth={auth} />;
}
