// Writes the MCP tool list (names, descriptions, input schemas, annotations)
// to src-tauri/src/mcp/tools.json, which the desktop app's built-in relay
// (`Open Keep.exe --mcp`, src-tauri/src/mcp/) serves as its own tools/list.
//
// src/server.ts stays the one place the tools are defined: change a tool
// there, then run
//
//   npm run export-tools
//
// and commit the JSON. `npm test` fails while the two differ.
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { listTools, TOOLS_JSON_PATH } from "./list-tools.mjs";

const tools = await listTools();
await writeFile(TOOLS_JSON_PATH, JSON.stringify(tools, null, 2) + "\n");
console.log(`Wrote ${tools.length} tools to ${fileURLToPath(TOOLS_JSON_PATH)}`);
