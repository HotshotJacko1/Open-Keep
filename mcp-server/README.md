# Open Keep MCP server

Bridges an MCP-capable AI tool to a user's Open Keep notes.

**Using this as an Open Keep user?** You want [MCP.md](../MCP.md) — install
instructions, the full command list, and troubleshooting. This file is about the
package itself.

## Architecture

```
AI tool  --MCP (stdio)-->  this server  <--WebSocket--  Open Keep (browser tab)
```

A browser tab can't open a listening socket, so this server listens (on
`127.0.0.1`, default port `8420`) and Open Keep dials out to it. The full
reasoning, including the options that were rejected, is in the project PRD.

This package holds **no note-storage or safety logic** — no size-limit
enforcement, no soft-delete semantics, no undo snapshots, no `ai-created` /
`ai-edited` tagging. All of that belongs to the Open Keep client, since that's
the side holding the user's decrypted notes. This server forwards requests and
returns whatever the client sends back.

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
npm run pack:mcpb   # builds the distributable bundle -> build/open-keep.mcpb
```

`test/mock-roundtrip.mjs` drives the real built server over stdio with a real
`@modelcontextprotocol/sdk` client, while a mock WebSocket stands in for the
Open Keep tab and answers with canned data. It covers: the "not connected" error
before anything is paired, a read + write + delete round trip once it is,
bridge-side errors surfacing as MCP tool errors, all 15 tools being registered,
and a wrong token being rejected and disconnected. 28 assertions.

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
| `src/protocol.ts` | Wire types shared with the app. Mirrored by hand in `src/lib/mcp-bridge/protocol.ts` — keep the two in step. |
| `src/bridge-server.ts` | The WebSocket listener, token check, and request/response correlation. |
| `src/server.ts` | Registers the 15 MCP tools; each one forwards to the bridge. |
| `src/config.ts` | Token and port resolution. |
| `src/index.ts` | Entry point. |
| `manifest.json` | MCPB manifest — tool list, `user_config`, platform compatibility. |
| `scripts/build-mcpb.mjs` | Staged production build + pack. |
