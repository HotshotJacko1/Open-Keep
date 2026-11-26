// Copyright (c) 2026. Licensed under AGPLv3.
//
// Desktop app only: the app can be its own MCP server (`Open Keep.exe --mcp`,
// src-tauri/src/mcp/), so an AI tool needs nothing else installed. These call
// the Rust commands in src-tauri/src/mcp/setup.rs.
import { invoke } from "@tauri-apps/api/core";

export interface RelayCommand {
  command: string;
  args: string[];
}

/**
 * Keeps the pairing token in Windows Credential Manager, where the `--mcp`
 * copies AI tools start read it, so setting up a tool needs no token. An
 * empty token removes it.
 */
export const shareTokenWithRelay = (token: string): Promise<void> => invoke("mcp_set_token", { token });

/** How an AI tool starts this app as an MCP server. */
export const getRelayCommand = (): Promise<RelayCommand> => invoke("mcp_relay_command");

/** Adds Open Keep to Claude Desktop's MCP servers. `changed` is false when it was already there. */
export const addToClaudeDesktop = (): Promise<{ path: string; changed: boolean }> =>
  invoke("mcp_add_to_claude_desktop");

const quote = (arg: string) => (/[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg);

/** Command lines and a config snippet for setting up tools by hand. */
export function relaySetupSnippets({ command, args }: RelayCommand) {
  const launch = [command, ...args].map(quote).join(" ");
  return {
    claudeCode: `claude mcp add --scope user open-keep -- ${launch}`,
    codex: `codex mcp add open-keep -- ${launch}`,
    json: JSON.stringify({ "open-keep": { command, args } }, null, 2),
  };
}
