// Copyright (c) 2026. Licensed under AGPLv3.
import React, { useState } from "react";
import { Capacitor } from "@capacitor/core";
import { isDesktopApp } from "@/lib/platform";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Info, Loader2 } from "lucide-react";
import { readWebDavFormDefaults } from "@/lib/webdav";
import type { WebDavConnectInput } from "@/hooks/use-webdav";

interface WebDavConnectFormProps {
  onConnect: (input: WebDavConnectInput) => Promise<void>;
  onCancel: () => void;
}

/** True when `address` is on the same origin as the app, where browsers don't apply CORS. */
const isSameOrigin = (address: string): boolean => {
  try {
    return new URL(address.trim()).origin === window.location.origin;
  } catch {
    return false;
  }
};

/** Address, folder and credentials for a WebDAV server (Nextcloud, ownCloud, Synology...). */
const WebDavConnectForm: React.FC<WebDavConnectFormProps> = ({ onConnect, onCancel }) => {
  const [defaults] = useState(readWebDavFormDefaults);
  const [serverUrl, setServerUrl] = useState(defaults.serverUrl);
  const [folder, setFolder] = useState(defaults.folder);
  const [username, setUsername] = useState(defaults.username);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  // Start in the first field that still needs filling in.
  const firstEmpty = !defaults.serverUrl ? "url" : !defaults.username ? "username" : "password";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onConnect({ serverUrl, folder, username, password });
    } finally {
      setBusy(false);
    }
  };

  // In a browser the server has to allow this site (CORS), unless it's on the
  // same address as the app (self-hosted together). The phone and desktop apps
  // aren't affected: their requests don't come from a web page.
  const showBrowserNote = !Capacitor.isNativePlatform() && !isDesktopApp() && !isSameOrigin(serverUrl);

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 border rounded-md p-4 bg-muted/50">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="webdav-url">WebDAV address</Label>
        <Input
          id="webdav-url"
          type="url"
          inputMode="url"
          autoComplete="url"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="https://cloud.example.com/remote.php/dav/files/you/"
          value={serverUrl}
          onChange={(e) => setServerUrl(e.target.value)}
          autoFocus={firstEmpty === "url"}
        />
        <p className="text-xs text-muted-foreground">
          In Nextcloud, it's under Files → Files settings (bottom left) → WebDAV.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="webdav-folder">Folder</Label>
        <Input
          id="webdav-folder"
          autoCapitalize="off"
          spellCheck={false}
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Created if it doesn't exist. Open Keep keeps its two files in it.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="webdav-username">Username</Label>
        <Input
          id="webdav-username"
          autoFocus={firstEmpty === "username"}
          autoComplete="username"
          autoCapitalize="off"
          spellCheck={false}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="webdav-password">App password</Label>
        <Input
          id="webdav-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus={firstEmpty === "password"}
        />
        <p className="text-xs text-muted-foreground">
          Use an app password from your server's security settings rather than your main password. It's stored on this device.
        </p>
      </div>
      {showBrowserNote && (
        <div className="flex gap-2 rounded-md border border-border bg-background/60 p-3 text-xs text-muted-foreground">
          <Info className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
          <p>
            In a browser, your server has to allow Open Keep to connect. Browsers block a website from
            talking to another site's server unless that server allows it (CORS), and Nextcloud doesn't
            by default. If connecting fails here, use the Android or iOS app, which don't have this
            limit, or ask whoever runs your server to allow it.
          </p>
        </div>
      )}
      <div className="flex flex-col gap-2 mt-1">
        <Button type="submit" disabled={busy || !serverUrl.trim() || !username.trim() || !password}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Connect
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
};

export default WebDavConnectForm;
