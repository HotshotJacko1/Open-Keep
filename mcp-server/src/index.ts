#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { BridgeServer } from "./bridge-server.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const { token, port } = loadConfig();
  const bridge = new BridgeServer(token, port);
  const server = createServer(bridge);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`[openkeep-mcp] fatal: ${err?.stack ?? err}\n`);
  process.exit(1);
});
