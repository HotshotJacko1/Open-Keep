// Copyright (c) 2026. Licensed under AGPLv3.
//
// Desktop app only: set up an AI tool to start Open Keep itself as its MCP
// server (`Open Keep.exe --mcp`). One click for Claude Desktop, a command to
// copy for the rest. No token involved: those copies read it from the app.
import React, { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Check, Copy } from "lucide-react";
import { showError, showSuccess } from "@/utils/toast";
import { addToClaudeDesktop, getRelayCommand, relaySetupSnippets } from "@/lib/mcp-desktop";

type Snippets = ReturnType<typeof relaySetupSnippets>;

const OTHER_TOOLS: { key: keyof Snippets; label: string; hint: string }[] = [
  { key: "claudeCode", label: "Claude Code", hint: "Run in a terminal" },
  { key: "codex", label: "Codex or ChatGPT desktop", hint: "Run in a terminal" },
  { key: "json", label: "Any other MCP app", hint: "Add to its MCP servers list" },
];

const AiToolConnectSection: React.FC = () => {
  const [snippets, setSnippets] = useState<Snippets | null>(null);
  const [adding, setAdding] = useState(false);
  const [copied, setCopied] = useState<keyof Snippets | null>(null);

  useEffect(() => {
    getRelayCommand()
      .then((cmd) => setSnippets(relaySetupSnippets(cmd)))
      .catch((err) => console.warn("Could not get the MCP command:", err));
  }, []);

  const connectClaudeDesktop = async () => {
    setAdding(true);
    try {
      const { changed } = await addToClaudeDesktop();
      showSuccess(
        changed
          ? "Added to Claude Desktop. Quit and reopen Claude Desktop to use it."
          : "Open Keep is already in Claude Desktop. If it doesn't show up, quit and reopen Claude Desktop."
      );
    } catch (err) {
      showError(typeof err === "string" ? err : "Couldn't add Open Keep to Claude Desktop.");
    } finally {
      setAdding(false);
    }
  };

  const copy = async (key: keyof Snippets) => {
    if (!snippets) return;
    try {
      await navigator.clipboard.writeText(snippets[key]);
      setCopied(key);
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000);
    } catch {
      showError("Couldn't copy to the clipboard.");
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-text-primary dark:text-text-primary">Connect an AI tool</Label>
      <p className="text-xs text-muted-foreground">
        The AI tool starts Open Keep's own MCP server, so there's nothing else to install and no token to paste.
      </p>
      <Button
        variant="outline"
        className="justify-start text-text-primary dark:text-text-primary"
        onClick={connectClaudeDesktop}
        disabled={adding}
      >
        Add to Claude Desktop
      </Button>
      <p className="text-xs text-muted-foreground">
        If you installed the Open Keep extension in Claude Desktop before, remove it in Claude Desktop's Settings &gt;
        Extensions, or Open Keep will appear twice.
      </p>
      <div className="flex flex-col divide-y rounded-md border">
        {OTHER_TOOLS.map(({ key, label, hint }) => (
          <div key={key} className="flex items-center justify-between gap-2 px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm text-text-primary dark:text-text-primary">{label}</p>
              <p className="text-xs text-muted-foreground">{hint}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0 text-text-primary dark:text-text-primary"
              disabled={!snippets}
              onClick={() => copy(key)}
              aria-label={`Copy setup for ${label}`}
            >
              {copied === key ? <Check className="h-3.5 w-3.5 mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
              {key === "json" ? "Copy config" : "Copy command"}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AiToolConnectSection;
