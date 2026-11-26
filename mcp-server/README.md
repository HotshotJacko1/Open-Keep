# Open Keep MCP server

Bridges an MCP-capable AI tool to a user's Open Keep notes.

**Using this as an Open Keep user?** You want [MCP.md](../MCP.md) — install
instructions, the full command list, and troubleshooting. This file is about the
package itself.

## Architecture

```
AI tool  --MCP (stdio)-->  this server  <--WebSocket--  Open Keep (desktop app or browser tab)
```

A web page can't open a listening socket (the desktop app runs the same web
code in WebView2), so this server listens (on
`127.0.0.1`, default port `8420`) and Open Keep dials out to it. The full
reasoning, including the options that were rejected, is in the project PRD.

This package holds **no note-storage or safety logic** — no size-limit
enforcement, no soft-delete semantics, no undo snapshots, no `ai-created` /
`ai-edited` tagging. All of that belongs to the Open Keep client, since that's
the side holding the user's decrypted notes. This server forwards requests and
returns whatever the client sends back.

### The desktop app's built-in copy

The Windows desktop app is also an MCP server: `open-keep.exe --mcp` runs a Rust
port of this package (`src-tauri/src/mcp/`) and opens no window, so desktop users
need neither Node nor the `.mcpb`. It speaks the same bridge protocol, serves the
same tools (`src-tauri/src/mcp/tools.json`, generated from `src/server.ts` by
`npm run export-tools`), and reads the token from Windows Credential Manager,
where the app keeps it. This package stays the way in for browser tabs and other
platforms.

When you change a tool in `src/server.ts`, run `npm run export-tools` and commit
the JSON; `npm test` fails while it is stale. When you change the protocol,
change `src-tauri/src/mcp/bridge.rs` too, and run `npm run test:relay` (after
`cargo build` in `src-tauri`), which runs this package's tests against the
desktop build.

## Pairing

Open Keep mints the token, in the browser, and displays it under
**Settings → AI Assistant Access**. It reaches this server as
`OPENKEEP_MCP_TOKEN`, supplied either by the `.mcpb` extension's `user_config`
field or by hand in an MCP client config.

Resolution order is env var → `~/.config/openkeep-mcp/config.json` → generate and
save one. That last fallback only exists so `npm start` does something sensible
while developing; in normal use the app is the source of truth.

## Development

```bash
npm install
npm run build       # tsc -> dist/
npm test            # builds, then runs test/mock-roundtrip.mjs
npm run test:relay  # the same tests against the desktop app's built-in copy
npm run export-tools # refresh src-tauri/src/mcp/tools.json after changing a tool
npm run pack:mcpb   # builds the distributable bundle -> build/open-keep.mcpb
```

`test/mock-roundtrip.mjs` drives the real built server over stdio with a real
`@modelcontextprotocol/sdk` client, while a mock WebSocket stands in for the
Open Keep tab and answers with canned data. It covers: the "not connected" error
before anything is paired, a read + write + delete round trip once it is,
bridge-side errors surfacing as MCP tool errors, all 15 tools being registered,
the v2 pairing handshake (a wrong client proof, an out-of-order message and a v1
client are all refused), and -- by transpiling the app's real
`src/lib/mcp-bridge/bridge-client.ts` -- that the app never sends a server that
can't prove the token anything derived from it, never serves it a request, and
stops dialling it, and that it pairs with the real server; and that two Open Keep
windows with one token take turns (standby) rather than fighting. 72 assertions.
It uses a random token and ports from 18400 up, so an installed copy of the
extension on 8420+ (or a second test run) doesn't interfere.

## Releasing

`npm run pack:mcpb` produces `build/open-keep.mcpb`. Attach that file to a GitHub
release; `MCP.md` points users at
`https://github.com/HotshotJacko1/Open-Keep/releases/latest`.

Bump `version` in **both** `package.json` and `manifest.json` before packing —
Claude Desktop reads the manifest's version to decide whether an update is
available.

The bundle is currently unsigned, so Claude Desktop warns that the publisher
can't be verified. `npx mcpb sign` can fix that given a code-signing certificate.

## Files

| Path | What it is |
| --- | --- |
| `src/protocol.ts` | Wire types shared with the app. Mirrored by hand in `src/lib/mcp-bridge/protocol.ts`, and in Rust in `src-tauri/src/mcp/bridge.rs` — keep all three in step. |
| `src/bridge-server.ts` | The WebSocket listener, the challenge-response handshake (the token never goes on the wire), and request/response correlation. |
| `src/server.ts` | Registers the 15 MCP tools; each one forwards to the bridge. |
| `src/config.ts` | Token and port resolution. |
| `src/index.ts` | Entry point. |
| `scripts/export-tools.mjs` | Writes the tool list to `src-tauri/src/mcp/tools.json` for the desktop app's copy. |
| `manifest.json` | MCPB manifest — tool list, `user_config`, platform compatibility. |
| `scripts/build-mcpb.mjs` | Staged production build + pack. |
