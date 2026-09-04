// Copyright (c) 2026. Licensed under AGPLv3.
//
// Wire protocol for the Open Keep MCP bridge. This is the client side of
// what the standalone `@openkeep/mcp-server` package (see the project's
// "Open Keep MCP Bridge" PRD) expects from an Open Keep tab. A browser tab
// can never open its own listening socket, so the local MCP server is the
// one that listens, and this client connects OUT to it.
//
// Kept as a hand-synced mirror of that package's src/protocol.ts rather
// than a shared import, since the two live in separate deployables today.
// If the types drift, the "hello"/"request"/"response" shapes below are
// the ones that matter -- keep them identical on both sides.

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

export type BridgeErrorCode = "NOT_FOUND" | "LIMIT_EXCEEDED" | "INVALID_PARAMS" | "INTERNAL";

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

export type InboundMessage = HelloAck | BridgeRequest;
export type OutboundMessage = HelloMessage | BridgeResponse;

export class BridgeError extends Error {
  code: BridgeErrorCode;
  constructor(code: BridgeErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "BridgeError";
  }
}
