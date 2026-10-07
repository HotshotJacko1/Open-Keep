import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BridgeServer } from "./bridge-server.js";
import type { BridgeOp } from "./protocol.js";

// From package.json (one level above dist/, and bundled into the .mcpb), so the
// version reported to MCP clients can't drift from the published one again.
const PACKAGE_VERSION: string = createRequire(import.meta.url)("../package.json").version;

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

/**
 * Builds the MCP server and registers all 15 tools from the PRD. Every
 * tool is a thin translation into one BridgeServer.call(op, params) —
 * this package holds no note-storage logic of its own (no note-limits
 * enforcement, no soft-delete semantics, no undo snapshots). All of that
 * lives on the Open Keep client side, which is what actually has the
 * user's decrypted notes; this process only ever sees whatever the client
 * chooses to send back.
 */
export function createServer(bridge: BridgeServer): McpServer {
  const server = new McpServer({ name: "open-keep", version: PACKAGE_VERSION });

  // MCP tool annotations. Clients use these to group tools and set default
  // permissions (Claude Desktop shows "Read-only tools" vs "Write/delete
  // tools" based on readOnlyHint). Nothing here is truly destructive — every
  // write is undoable in the app and delete_note is a soft delete — but tag
  // renames/removals touch many notes at once, so those are flagged.
  const READ = { readOnlyHint: true, openWorldHint: false } as const;
  const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
  const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } as const;

  type Annotations = typeof READ | typeof WRITE | typeof DESTRUCTIVE;

  const tool = (
    name: string,
    op: BridgeOp,
    description: string,
    inputSchema: Record<string, z.ZodTypeAny>,
    annotations: Annotations
  ): void => {
    server.registerTool(
      name,
      { title: name, description, inputSchema, annotations },
      async (params: Record<string, unknown>) => {
        try {
          return ok(await bridge.call(op, params));
        } catch (err) {
          return fail(err);
        }
      }
    );
  };

  // --- Note commands -------------------------------------------------

  tool(
    "list_all_notes",
    "list_all_notes",
    "List all of the user's Open Keep notes as summaries (title, tags, pinned/archived, timestamps) — not full content. Deleted notes are excluded.",
    {},
    READ
  );

  tool(
    "search_notes",
    "search_notes",
    "Search the user's Open Keep notes by text, matched against title and content.",
    { query: z.string().min(1).describe("Text to search for") },
    READ
  );

  tool(
    "get_note",
    "get_note",
    "Retrieve the full content of one Open Keep note by id.",
    { id: z.string().describe("Note id, from list_all_notes or search_notes") },
    READ
  );

  tool(
    "create_note",
    "create_note",
    'Create a new Open Keep note. It is auto-tagged "ai-created" and subject to the app\'s normal size limits.',
    {
      title: z.string().min(1).describe("Note title"),
      content: z.string().default("").describe("Note body"),
      tags: z.array(z.string()).optional().describe('Extra tags, beyond the automatic "ai-created" tag'),
    },
    WRITE
  );

  tool(
    "update_note",
    "update_note",
    "Replace the title and/or content of an existing note. The previous version is snapshotted in the app for one-click Undo.",
    {
      id: z.string(),
      title: z.string().optional(),
      content: z.string().optional(),
    },
    WRITE
  );

  tool(
    "append_to_note",
    "append_to_note",
    "Add text to the end of an existing note.",
    { id: z.string(), text: z.string().min(1) },
    WRITE
  );

  tool(
    "prepend_to_note",
    "prepend_to_note",
    "Add text to the beginning of an existing note.",
    { id: z.string(), text: z.string().min(1) },
    WRITE
  );

  tool(
    "delete_note",
    "delete_note",
    "Move a note to the bin (soft delete) — recoverable from Open Keep's bin for 30 days, the same as deleting it by hand. This never permanently deletes a note.",
    { id: z.string() },
    DESTRUCTIVE
  );

  // --- Tag commands ----------------------------------------------------

  tool(
    "list_tags",
    "list_tags",
    "List every tag currently used across the user's notes.",
    {},
    READ
  );

  tool(
    "add_tags_to_note",
    "add_tags_to_note",
    "Add one or more tags to a note.",
    { id: z.string(), tags: z.array(z.string()).min(1) },
    WRITE
  );

  tool(
    "remove_tags_from_note",
    "remove_tags_from_note",
    "Remove one or more tags from a note.",
    { id: z.string(), tags: z.array(z.string()).min(1) },
    WRITE
  );

  tool(
    "rename_tag",
    "rename_tag",
    "Rename a tag everywhere it's used. Affects every note carrying it; each note is individually undo-able afterward.",
    { from: z.string().describe("Current tag name"), to: z.string().describe("New tag name") },
    DESTRUCTIVE
  );

  tool(
    "delete_tag",
    "delete_tag",
    "Remove a tag from every note that carries it. Notes themselves are not touched beyond losing that one tag — this does not delete any notes.",
    { tag: z.string() },
    DESTRUCTIVE
  );

  tool(
    "get_notes_by_tag",
    "get_notes_by_tag",
    "List all notes (summaries) that carry a given tag.",
    { tag: z.string() },
    READ
  );

  tool(
    "get_tag_by_id",
    "get_tag_by_id",
    "Look up a tag by name. Open Keep tags are plain strings, not separate entities with their own IDs, so the tag name is used as its id.",
    { id: z.string().describe("The tag name") },
    READ
  );

  return server;
}
