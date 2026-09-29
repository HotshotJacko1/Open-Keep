// Dry-run verification for the Open Keep MCP server, standing in for the
// app-side dyad-apps/Open Keep repo has no test tooling of its own
// (see project memory: open-keep-note-limits.md), so this package gets
// its own script-based harness in the same spirit: a real MCP Client
// (the same SDK class Claude Desktop etc. use) drives the real built
// server over stdio, while a mock WebSocket client stands in for the
// Open Keep browser tab and answers with canned data. Proves the full
// request/response round trip, the v2 pairing handshake (mutual
// HMAC challenge-response -- the token never crosses the wire), and the
// "not connected" error path.
//
// The later sections also load the app's REAL browser-side bridge client
// (src/lib/mcp-bridge/bridge-client.ts + protocol.ts, transpiled on the
// fly) and point it at fake "squatter" servers, to prove it never hands a
// server that can't prove the token anything derived from it, never serves
// it a request, and stops dialling it -- and then at the real server, to
// prove the two hand-synced protocol.ts copies actually interoperate.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { WebSocket, WebSocketServer } from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { BRIDGE_PROTOCOL_VERSION, proofInput } from "../dist/protocol.js";

const TOKEN = "test-token-12345";
// Well away from the real default range (8420-8424), so a copy of the Open
// Keep extension already running on this machine can't answer the test's
// connections (it would, with a different token, and the test would hang).
const PORT = 18421;
/** Base of a port range used only by the fake "squatter" servers. */
const FAKE_BASE = 18531;

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hmac = (token, input) => createHmac("sha256", token).update(input, "utf8").digest("hex");
const nonce = () => randomBytes(32).toString("hex");

function nextMessage(ws) {
  return new Promise((resolve) => {
    ws.once("message", (raw) => resolve(JSON.parse(raw.toString())));
  });
}

/**
 * Runs the client half of the v2 handshake by hand, the way the app does.
 * `proofToken` lets a test answer with the wrong token.
 */
async function pair(ws, port, { token = TOKEN, proofToken = token } = {}) {
  const clientNonce = nonce();
  const challengeP = nextMessage(ws);
  const hello = { type: "hello", protocolVersion: BRIDGE_PROTOCOL_VERSION, clientNonce, appVersion: "mock/0.0" };
  ws.send(JSON.stringify(hello));
  const challenge = await challengeP;
  const serverProofValid =
    challenge.type === "challenge" &&
    challenge.serverProof === hmac(token, proofInput("server", port, clientNonce, challenge.serverNonce));
  const ackP = nextMessage(ws);
  ws.send(
    JSON.stringify({
      type: "auth",
      clientProof: hmac(proofToken, proofInput("client", port, clientNonce, challenge.serverNonce)),
    })
  );
  const ack = await ackP;
  return { hello, challenge, serverProofValid, ack };
}

/**
 * Transpiles the app's browser-side bridge client to plain ESM in a temp
 * dir and imports it. Node has WebSocket, TextEncoder and crypto.subtle as
 * globals, which is everything the client touches.
 */
async function loadBrowserClient() {
  const dir = await mkdtemp(join(tmpdir(), "openkeep-bridge-client-"));
  for (const name of ["protocol", "bridge-client"]) {
    const src = await readFile(new URL(`../../src/lib/mcp-bridge/${name}.ts`, import.meta.url), "utf8");
    const out = ts
      .transpileModule(src, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      })
      .outputText.replace(/from "\.\/protocol"/g, 'from "./protocol.mjs"');
    await writeFile(join(dir, `${name}.mjs`), out);
  }
  const mod = await import(pathToFileURL(join(dir, "bridge-client.mjs")).href);
  return { mod, dir };
}

/**
 * A fake server squatting on FAKE_BASE. Records every connection and every
 * frame the client sends it; `onHello(ws, hello)` decides how it answers.
 */
async function squatter(onHello) {
  const wss = new WebSocketServer({ port: FAKE_BASE, host: "127.0.0.1" });
  await once(wss, "listening");
  const log = { connections: 0, frames: [] };
  wss.on("connection", (ws) => {
    log.connections++;
    ws.on("message", (raw) => {
      const text = raw.toString();
      log.frames.push(text);
      const msg = JSON.parse(text);
      if (msg.type === "hello") onHello(ws, msg);
    });
  });
  return {
    log,
    close: () => new Promise((r) => {
      for (const c of wss.clients) c.terminate();
      wss.close(() => r());
    }),
  };
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

  // --- 1b. An old (v1) tab is refused with a clear protocol mismatch ----
  console.log("\n1b) a v1 tab (token in hello, no protocolVersion) is refused as a version mismatch");
  const v1Ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  await once(v1Ws, "open");
  const v1AckP = nextMessage(v1Ws);
  v1Ws.send(JSON.stringify({ type: "hello", token: TOKEN, appVersion: "open-keep-web" }));
  const v1Ack = await v1AckP;
  assert(v1Ack.type === "hello_ack" && v1Ack.ok === false && v1Ack.reason === "protocol_mismatch", "hello_ack.ok is false with reason protocol_mismatch");
  await once(v1Ws, "close");
  assert(true, "server closes the v1 socket");
  const afterV1 = await client.callTool({ name: "list_all_notes", arguments: {} });
  assert(
    afterV1.isError === true && /different bridge protocol version/i.test(afterV1.content?.[0]?.text ?? ""),
    "tool error explains the protocol version mismatch"
  );

  // --- 2. Connect the mock "browser tab" and pair -----------------------
  console.log("\n2) mock browser tab connects and pairs (v2 challenge-response)");
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  await once(ws, "open");

  const paired = await pair(ws, PORT);
  assert(!JSON.stringify(paired.hello).includes(TOKEN), "hello carries no token");
  assert(paired.challenge.type === "challenge" && paired.challenge.protocolVersion === BRIDGE_PROTOCOL_VERSION, "server answers hello with a v2 challenge");
  assert(paired.serverProofValid, "server proves it holds the token before the client sends any proof");
  assert(paired.ack.type === "hello_ack" && paired.ack.ok === true, "pairing succeeds with a correct client proof");

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

  // --- 8. Wrong client proof is rejected -------------------------------
  console.log("\n8) a second connection with a proof from the wrong token is rejected");
  const badWs = new WebSocket(`ws://127.0.0.1:${PORT}`);
  await once(badWs, "open");
  const badFrames = [];
  const bad = await pair(badWs, PORT, { proofToken: "wrong-token" });
  badWs.on("message", (raw) => badFrames.push(raw.toString()));
  assert(bad.ack.type === "hello_ack" && bad.ack.ok === false && bad.ack.reason === "bad_proof", "hello_ack.ok is false with reason bad_proof");
  await once(badWs, "close");
  assert(badFrames.length === 0, "server closes the socket and sends nothing more after rejecting the proof");
  const stillPaired = await client.callTool({ name: "list_all_notes", arguments: {} });
  assert(/Grocery list/.test(stillPaired.content?.[0]?.text ?? ""), "the rejected connection did not displace the paired tab");

  console.log("\n8b) skipping the challenge (auth before hello) is rejected");
  const skipWs = new WebSocket(`ws://127.0.0.1:${PORT}`);
  await once(skipWs, "open");
  const skipAckP = nextMessage(skipWs);
  skipWs.send(JSON.stringify({ type: "auth", clientProof: "00".repeat(32) }));
  const skipAck = await skipAckP;
  assert(skipAck.ok === false && skipAck.reason === "bad_message", "out-of-order auth gets hello_ack ok:false bad_message");
  await once(skipWs, "close");

  // --- 9. A second instance takes the next port and runs independently -
  // Every MCP client spawns its own copy of the server. Before the port
  // range, the second copy lost the race for the port and then reported
  // "not connected" forever while the app sat there showing Connected.
  console.log("\n9) a second server instance binds the next port and serves its own client");
  const transport2 = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    env: { ...process.env, OPENKEEP_MCP_TOKEN: TOKEN, OPENKEEP_MCP_PORT: String(PORT) },
    stderr: "pipe",
  });
  const client2 = new Client({ name: "test-client-2", version: "0.0.0" });
  await client2.connect(transport2);

  const ws2 = new WebSocket(`ws://127.0.0.1:${PORT + 1}`);
  await once(ws2, "open");
  assert(true, `second instance is listening on ${PORT + 1}, not fighting over ${PORT}`);

  const paired2 = await pair(ws2, PORT + 1);
  assert(paired2.serverProofValid && paired2.ack.ok === true, "second instance pairs with the same token (proof bound to its own port)");

  // Distinct payload, so we can prove each client is served by its own bridge.
  ws2.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type !== "request") return;
    ws2.send(JSON.stringify({
      type: "response",
      id: msg.id,
      ok: true,
      data: [{ id: "second", title: "From the second tab", tags: [], isPinned: false, isArchived: false, createdAt: 1, updatedAt: 1 }],
    }));
  });

  const fromSecond = await client2.callTool({ name: "list_all_notes", arguments: {} });
  assert(fromSecond.isError !== true, "second client's tool call succeeds");
  assert(
    /From the second tab/.test(fromSecond.content?.[0]?.text ?? ""),
    "second client is served by its own bridge, not the first"
  );

  const stillFirst = await client.callTool({ name: "list_all_notes", arguments: {} });
  assert(
    /Grocery list/.test(stillFirst.content?.[0]?.text ?? ""),
    "first client is unaffected by the second instance"
  );

  // --- 10. Closing one instance leaves the other working ---------------
  console.log("\n10) closing one instance doesn't disturb the other");
  ws2.close();
  await client2.close();
  await sleep(300);

  const afterSecondClosed = await client.callTool({ name: "list_all_notes", arguments: {} });
  assert(
    /Grocery list/.test(afterSecondClosed.content?.[0]?.text ?? ""),
    "first client still works after the second instance exits"
  );

  // --- 11-14. The app's real bridge client vs. squatters -----------------
  const { mod, dir } = await loadBrowserClient();
  const { McpBridgeClient } = mod;
  // Short delays so "it stopped redialling" can be observed quickly: any
  // retry would have happened several times over in the wait below.
  const fastOptions = { retryDelayMs: 100, sweepDelayMs: 100, handshakeTimeoutMs: 2000 };

  /**
   * Points a real McpBridgeClient at a squatter and reports what the
   * squatter saw and what the client ended up believing.
   */
  async function runAgainstSquatter(onHello) {
    const fake = await squatter(onHello);
    let handled = 0;
    let last = { state: "disconnected", count: 0, reason: null };
    const bc = new McpBridgeClient((state, count, reason) => {
      last = { state, count, reason };
    }, fastOptions);
    bc.connect(TOKEN, FAKE_BASE, async (req) => {
      handled++;
      return { type: "response", id: req.id, ok: true, data: [] };
    });
    await sleep(1000);
    const connectionsBeforeRetry = fake.log.connections;
    const result = { log: fake.log, handled, last, connectionsBeforeRetry, bc, fake };
    return result;
  }

  function assertLeakedNothing(r, label) {
    const types = r.log.frames.map((f) => JSON.parse(f).type);
    assert(types.length === 1 && types[0] === "hello", `${label}: squatter received only the hello (got ${JSON.stringify(types)})`);
    const hello = JSON.parse(r.log.frames[0] ?? "{}");
    assert(
      r.log.frames.every((f) => !f.includes(TOKEN)) &&
        Object.keys(hello).every((k) => ["type", "protocolVersion", "clientNonce", "appVersion"].includes(k)),
      `${label}: nothing token-derived was sent (hello = type/version/nonce/appVersion only)`
    );
    assert(r.handled === 0, `${label}: client never served a request from it`);
    assert(r.connectionsBeforeRetry === 1, `${label}: client stopped dialling that port (${r.connectionsBeforeRetry} connection(s) in 1s at a 100ms retry cadence)`);
  }

  console.log("\n11) squatter that skips the proof and just acks + sends a request");
  const r11 = await runAgainstSquatter((sock) => {
    sock.send(JSON.stringify({ type: "hello_ack", ok: true }));
    sock.send(JSON.stringify({ type: "request", id: "steal", op: "list_all_notes", params: {} }));
  });
  assertLeakedNothing(r11, "unearned ack");
  assert(r11.last.state === "rejected" && r11.last.reason === "untrusted", `client surfaces "rejected"/untrusted (got ${r11.last.state}/${r11.last.reason})`);
  // Terminal until the user acts: connect() again (retry / re-pair) re-dials.
  r11.bc.connect(TOKEN, FAKE_BASE, async (req) => ({ type: "response", id: req.id, ok: true, data: [] }));
  await sleep(300);
  assert(r11.log.connections === 2, "an explicit connect() (user retry) dials the port again");
  r11.bc.disconnect();
  await r11.fake.close();

  console.log("\n12) squatter that sends a challenge with a made-up proof");
  const r12 = await runAgainstSquatter((sock) => {
    sock.send(JSON.stringify({ type: "challenge", protocolVersion: BRIDGE_PROTOCOL_VERSION, serverNonce: nonce(), serverProof: nonce() }));
  });
  assertLeakedNothing(r12, "forged proof");
  assert(r12.last.state === "rejected" && r12.last.reason === "untrusted", "client surfaces rejected/untrusted");
  r12.bc.disconnect();
  await r12.fake.close();

  console.log("\n13) relay: a proof valid for a different port (what a squatter forwarding to the real server gets)");
  const r13 = await runAgainstSquatter((sock, hello) => {
    const serverNonce = nonce();
    sock.send(JSON.stringify({
      type: "challenge",
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      serverNonce,
      serverProof: hmac(TOKEN, proofInput("server", FAKE_BASE + 1, hello.clientNonce, serverNonce)),
    }));
  });
  assertLeakedNothing(r13, "relayed proof");
  r13.bc.disconnect();
  await r13.fake.close();

  console.log("\n14) a server that refuses the handshake (protocol_mismatch) is terminal too");
  const r14 = await runAgainstSquatter((sock) => {
    sock.send(JSON.stringify({ type: "hello_ack", ok: false, reason: "protocol_mismatch" }));
    sock.close();
  });
  assert(r14.connectionsBeforeRetry === 1, "client does not redial a port that refused it");
  assert(r14.last.state === "rejected" && r14.last.reason === "incompatible", `client surfaces rejected/incompatible (got ${r14.last.state}/${r14.last.reason})`);
  r14.bc.disconnect();
  await r14.fake.close();

  // --- 15. The app's real client pairs with the real server ---------------
  console.log("\n15) the app's real bridge client pairs with the real server and serves a tool call");
  let realState = { state: "disconnected", count: 0 };
  const realClient = new McpBridgeClient((state, count) => {
    realState = { state, count };
  }, fastOptions);
  realClient.connect(TOKEN, PORT, async (req) => ({
    type: "response",
    id: req.id,
    ok: true,
    data: [{ id: "real", title: "From the real browser client", tags: [], isPinned: false, isArchived: false, createdAt: 1, updatedAt: 1 }],
  }));
  for (let i = 0; i < 50 && realState.state !== "connected"; i++) await sleep(50);
  assert(realState.state === "connected" && realState.count === 1, `real client reaches "connected" (got ${realState.state}, ${realState.count})`);
  const viaRealClient = await client.callTool({ name: "list_all_notes", arguments: {} });
  assert(/From the real browser client/.test(viaRealClient.content?.[0]?.text ?? ""), "tool call is answered by the real browser client end to end");
  realClient.disconnect();
  await rm(dir, { recursive: true, force: true });

  ws.close();
  await client.close();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
