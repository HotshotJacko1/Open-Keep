// Shared by export-tools.mjs and the test: asks the built Node server for its
// tool list over stdio, exactly as an MCP client sees it.
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export const TOOLS_JSON_PATH = new URL("../../src-tauri/src/mcp/tools.json", import.meta.url);

export async function listTools() {
  const transport = new StdioClientTransport({
    command: "node",
    args: [fileURLToPath(new URL("../dist/index.js", import.meta.url))],
    // A throwaway token, and a port range nothing else uses: this copy only
    // answers tools/list and exits.
    env: { ...process.env, OPENKEEP_MCP_TOKEN: randomBytes(8).toString("hex"), OPENKEEP_MCP_PORT: "29870" },
    stderr: "pipe",
  });
  const client = new Client({ name: "open-keep-export-tools", version: "0.0.0" });
  await client.connect(transport);
  const { tools } = await client.listTools();
  await client.close();
  return tools;
}
