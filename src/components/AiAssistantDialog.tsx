// Copyright (c) 2026. Licensed under AGPLv3.
//
// Settings surface for the Open Keep MCP Bridge. Pairing, the two consent
// switches, and the "AI Activity" log all live here; the actual bridge
// logic is owned by useMcpBridge (src/hooks/use-mcp-bridge.ts), mounted
// once in Index.tsx and passed down as the `aiBridge` prop.
import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bot, Undo2, Circle, Copy, Check, Eye, EyeOff, RefreshCw } from "lucide-react";
import { McpBridgeState } from "@/hooks/use-mcp-bridge";

interface AiAssistantDialogProps {
  isOpen: boolean;
  onClose: () => void;
  aiBridge: McpBridgeState;
}

const STATUS_COPY: Record<McpBridgeState["connectionState"], { label: string; className: string }> = {
  connected: { label: "Connected", className: "text-green-600 dark:text-green-400" },
  connecting: { label: "Connecting…", className: "text-muted-foreground" },
  disconnected: { label: "Not connected", className: "text-muted-foreground" },
  rejected: { label: "Token rejected", className: "text-destructive" },
};

function timeAgo(ts: number): string {
  const seconds = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

const AiAssistantDialog: React.FC<AiAssistantDialogProps> = ({ isOpen, onClose, aiBridge }) => {
  const { connectionState, readEnabled, writeEnabled, setReadEnabled, setWriteEnabled, token, regenerateToken, activity, undoActivity, disconnectAccess } = aiBridge;
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const status = STATUS_COPY[connectionState];
  // A token always exists now (the hook mints one), so "is anything actually
  // switched on" is the thing worth offering to revoke.
  const canRevoke = readEnabled || writeEnabled || connectionState === "connected";

  const copyToken = async () => {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked (insecure context, permissions). Reveal the
      // token instead so it can still be copied by hand.
      setRevealed(true);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-text-primary dark:text-text-primary">
            <Bot className="h-5 w-5" />
            AI Assistant Access
          </DialogTitle>
          <DialogDescription>
            Let a paired AI tool (via the Open Keep MCP server, running on this computer) search, read, and
            manage your notes while this tab is open. Off by default.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 overflow-y-auto pr-1">
          <div className="flex items-center gap-2 text-sm">
            <Circle className={`h-2.5 w-2.5 fill-current ${status.className}`} />
            <span className={status.className}>{status.label}</span>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="ai-pairing-token" className="text-text-primary dark:text-text-primary">Your pairing token</Label>
            <p className="text-xs text-muted-foreground">
              Copy this and paste it into the Open Keep extension when you install it in your AI tool. Treat it like a password.
            </p>
            <div className="flex gap-2">
              <Input
                id="ai-pairing-token"
                type={revealed ? "text" : "password"}
                readOnly
                value={token}
                onFocus={(e) => e.currentTarget.select()}
                className="font-mono text-xs text-text-primary dark:text-text-primary"
              />
              <Button
                variant="outline"
                size="icon"
                className="shrink-0 text-text-primary dark:text-text-primary"
                aria-label={revealed ? "Hide token" : "Show token"}
                onClick={() => setRevealed((v) => !v)}
              >
                {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="shrink-0 text-text-primary dark:text-text-primary"
                aria-label="Copy token"
                onClick={copyToken}
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <button
              type="button"
              className="self-start inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
              onClick={() => { regenerateToken(); setCopied(false); }}
            >
              <RefreshCw className="h-3 w-3" />
              Generate a new token
            </button>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="ai-read-toggle" className="text-text-primary dark:text-text-primary">Let AI read notes</Label>
                <p className="text-xs text-muted-foreground">Search and view your notes.</p>
              </div>
              <Switch id="ai-read-toggle" checked={readEnabled} onCheckedChange={setReadEnabled} />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="ai-write-toggle" className="text-text-primary dark:text-text-primary">Let AI create, edit &amp; delete notes</Label>
                <p className="text-xs text-muted-foreground">
                  Deletes are recoverable from the bin for 30 days, same as deleting by hand. Every change gets a one-click Undo below.
                </p>
              </div>
              <Switch id="ai-write-toggle" checked={writeEnabled} onCheckedChange={setWriteEnabled} />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label className="text-text-primary dark:text-text-primary">AI Activity {activity.length > 0 && `(${activity.length})`}</Label>
            {activity.length === 0 ? (
              <p className="text-xs text-muted-foreground">No AI activity yet this session.</p>
            ) : (
              <ScrollArea className="h-40 rounded-md border">
                <div className="flex flex-col divide-y">
                  {activity.map((entry) => (
                    <div key={entry.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate">{entry.label}</p>
                        <p className="text-xs text-muted-foreground">{timeAgo(entry.timestamp)}</p>
                      </div>
                      <Button variant="ghost" size="sm" className="shrink-0" onClick={() => undoActivity(entry.id)}>
                        <Undo2 className="h-3.5 w-3.5 mr-1" />
                        Undo
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>

          {canRevoke && (
            <div className="flex flex-col gap-1">
              <Button variant="destructive" className="w-full" onClick={() => { disconnectAccess(); setCopied(false); }}>
                Disconnect AI access
              </Button>
              <p className="text-xs text-muted-foreground">
                Turns both switches off and retires this token, so anything paired with it stops working. A new token is issued for next time.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AiAssistantDialog;
