// Dry-run verification for the Open Keep MCP server, standing in for the
// app-side dyad-apps/Open Keep repo has no test tooling of its own
// (see project memory: open-keep-note-limits.md), so this package gets
// its own script-based harness in the same spirit: a real MCP Client
// (the same SDK class Claude Desktop etc. use) drives the real built
// server over stdio, while a mock WebSocket client stands in for the
// Open Keep browser tab that hasn't been built yet and answers with
// canned data. Proves the full request/response round trip, the
// pairing/token check, and the "not connected" error path.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { WebSocket } from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const TOKEN = "test-token-12345";
const PORT = 8421;

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ok - ${message}`);
  } else {
    failed++;
    console.error(`  FAIL - ${message}`);
  }
}

async function main() {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    env: { ...process.env, OPENKEEP_MCP_TOKEN: TOKEN, OPENKEEP_MCP_PORT: String(PORT) },
    stderr: "pipe",
  });

  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(transport);
  console.log("MCP client connected to server over stdio.");

  // --- 1. Calling a tool before any "browser tab" is connected --------
  console.log("\n1) tool call with no Open Keep client connected");
  const beforeConnect = await client.callTool({ name: "list_all_notes", arguments: {} });
  assert(beforeConnect.isError === true, "returns isError");
  assert(
    /not connected/i.test(beforeConnect.content?.[0]?.text ?? ""),
    "error message tells the user Open Keep isn't connected"
  );

  // --- 2. Connect the mock "browser tab" and pair -----------------------
  console.log("\n2) mock browser tab connects and pairs");
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  await once(ws, "open");

  const helloAck = new Promise((resolve) => {
    ws.once("message", (raw) => resolve(JSON.parse(raw.toString())));
  });
  ws.send(JSON.stringify({ type: "hello", token: TOKEN, appVersion: "mock/0.0" }));
  const ack = await helloAck;
  assert(ack.type === "hello_ack" && ack.ok === true, "pairing succeeds with the correct token");

  // Mock handler: answers bridge requests with canned data so we can
  // assert the MCP tool call actually received it end-to-end.
  const mockNotes = [
    { id: "n1", title: "Grocery list", tags: ["ai-created"], isPinned: false, isArchived: false, createdAt: 1, updatedAt: 1 },
  ];
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type !== "request") return;

    if (msg.op === "list_all_notes") {
      ws.send(JSON.stringify({ type: "response", id: msg.id, ok: true, data: mockNotes }));
    } else if (msg.op === "create_note") {
      ws.send(
        JSON.stringify({
          type: "response",
          id: msg.id,
          ok: true,
          data: { id: "n2", title: msg.params.title, content: msg.params.content, tags: ["ai-created"], type: "text", isPinned: false, isArchived: false, createdAt: 2, updatedAt: 2 },
        })
      );
    } else if (msg.op === "delete_note") {
      ws.send(JSON.stringify({ type: "response", id: msg.id, ok: true, data: { id: msg.params.id, deleted: true } }));
    } else if (msg.op === "get_note") {
      ws.send(JSON.stringify({ type: "response", id: msg.id, ok: false, error: { code: "NOT_FOUND", message: "No note with that id." } }));
    }
  });

  // --- 3. Read round trip -------------------------------------------
  console.log("\n3) list_all_notes round trip");
  const list = await client.callTool({ name: "list_all_notes", arguments: {} });
  const listData = JSON.parse(list.content[0].text);
  assert(!list.isError, "no error once connected");
  assert(Array.isArray(listData) && listData[0]?.id === "n1", "returns the mock note the browser tab sent back");

  // --- 4. Write round trip -------------------------------------------
  console.log("\n4) create_note round trip");
  const created = await client.callTool({
    name: "create_note",
    arguments: { title: "Test note", content: "hello" },
  });
  const createdData = JSON.parse(created.content[0].text);
  assert(createdData.id === "n2" && createdData.title === "Test note", "create_note returns the created note");

  // --- 5. Delete (soft) round trip ------------------------------------
  console.log("\n5) delete_note round trip");
  const deleted = await client.callTool({ name: "delete_note", arguments: { id: "n2" } });
  const deletedData = JSON.parse(deleted.content[0].text);
  assert(deletedData.deleted === true, "delete_note reports success");

  // --- 6. Bridge-side error propagates as a tool error -----------------
  console.log("\n6) bridge error (NOT_FOUND) propagates");
  const missing = await client.callTool({ name: "get_note", arguments: { id: "nope" } });
  assert(missing.isError === true, "isError set");
  assert(/no note with that id/i.test(missing.content[0].text), "error message passed through");

  // --- 7. Full 15-tool surface is actually registered -------------------
  console.log("\n7) all 15 tools are registered");
  const { tools } = await client.listTools();
  const expected = [
    "list_all_notes", "search_notes", "get_note", "create_note", "update_note",
    "append_to_note", "prepend_to_note", "delete_note", "list_tags",
    "add_tags_to_note", "remove_tags_from_note", "rename_tag", "delete_tag",
    "get_tag_by_id", "get_notes_by_tag",
  ];
  const names = tools.map((t) => t.name).sort();
  assert(expected.length === 15, "expected list has 15 entries");
  for (const name of expected) {
    assert(names.includes(name), `tool "${name}" is registered`);
  }
  assert(names.length === 15, `exactly 15 tools registered (found ${names.length})`);

  // --- 8. Wrong pairing token is rejected -----------------------------
  console.log("\n8) a second connection with the wrong token is rejected");
  const badWs = new WebSocket(`ws://127.0.0.1:${PORT}`);
  await once(badWs, "open");
  const badAck = new Promise((resolve) => {
    badWs.once("message", (raw) => resolve(JSON.parse(raw.toString())));
  });
  badWs.send(JSON.stringify({ type: "hello", token: "wrong-token" }));
  const badAckMsg = await badAck;
  assert(badAckMsg.ok === false, "hello_ack.ok is false for a wrong token");
  await once(badWs, "close");
  assert(true, "server closes the socket after rejecting a bad token");

  ws.close();
  await client.close();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
