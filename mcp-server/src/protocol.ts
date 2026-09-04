// Wire protocol between the Open Keep MCP server (this package) and an
// Open Keep client — today a browser tab at app.openkeep.net, later
// potentially a native PC app. Whichever is running connects OUT to this
// server's WebSocket listener (a browser tab can never open its own
// listening socket), authenticates once with a shared pairing token, and
// then answers "request" messages with "response" messages.
//
// See the PRD ("Open Keep MCP Bridge") for the full design and the
// per-tool safety rules (soft-delete only, one-step undo, note-limits.ts
// enforcement, ai-created/ai-edited tagging) that the CLIENT side is
// responsible for implementing when it applies each op.

export interface NoteSummary {
  id: string;
  title: string;
  tags: string[];
  isPinned: boolean;
  isArchived: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface NoteFull extends NoteSummary {
  content: string;
  type: "text" | "list";
}

export interface TagInfo {
  name: string;
  noteCount: number;
}

/** The 15 operations the MCP tool surface exposes, 1:1 with the PRD's tool list. */
export type BridgeOp =
  | "list_all_notes"
  | "search_notes"
  | "get_note"
  | "create_note"
  | "update_note"
  | "append_to_note"
  | "prepend_to_note"
  | "delete_note"
  | "list_tags"
  | "add_tags_to_note"
  | "remove_tags_from_note"
  | "rename_tag"
  | "delete_tag"
  | "get_notes_by_tag"
  | "get_tag_by_id";

export type BridgeErrorCode =
  | "NOT_FOUND"
  | "LIMIT_EXCEEDED"
  | "INVALID_PARAMS"
  | "INTERNAL";

export interface BridgeRequest {
  type: "request";
  id: string;
  op: BridgeOp;
  params: Record<string, unknown>;
}

export interface BridgeResponseOk {
  type: "response";
  id: string;
  ok: true;
  data: unknown;
}

export interface BridgeResponseErr {
  type: "response";
  id: string;
  ok: false;
  error: { code: BridgeErrorCode; message: string };
}

export type BridgeResponse = BridgeResponseOk | BridgeResponseErr;

/** First message the client must send after connecting. */
export interface HelloMessage {
  type: "hello";
  token: string;
  appVersion?: string;
}

export interface HelloAck {
  type: "hello_ack";
  ok: boolean;
  reason?: string;
}

export type InboundMessage = HelloMessage | BridgeResponse;
export type OutboundMessage = HelloAck | BridgeRequest;
