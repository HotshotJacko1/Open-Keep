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
// If the types drift, the handshake block (BRIDGE_PROTOCOL_VERSION,
// hello/challenge/auth/hello_ack, proofInput) and the "request"/"response"
// shapes below are the ones that matter -- keep them identical on both sides.
// The desktop app's built-in server (src-tauri/src/mcp/bridge.rs) is a third,
// Rust copy of the server side.

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

// --- Handshake (protocol v2) -----------------------------------------------
//
// Mutual challenge-response, so the pairing token itself never crosses the
// wire and the tab never answers a process that can't prove it holds the
// token too. (v1 sent the raw token in "hello" to whatever was listening on
// the port, and trusted any hello_ack {ok:true} that came back.)
//
//   client -> server  hello     { protocolVersion, clientNonce }
//   server -> client  challenge { protocolVersion, serverNonce,
//                                 serverProof = HMAC(token, proofInput("server", ...)) }
//   client            verifies serverProof; on failure closes WITHOUT sending
//                     anything else and stops dialling that port
//   client -> server  auth      { clientProof = HMAC(token, proofInput("client", ...)) }
//   server -> client  hello_ack { ok } -- only after clientProof checks out
//
// One window at a time. Each server serves one Open Keep window. When a
// second window pairs (say the desktop app and a browser tab hold the same
// token), the newest takes over: the server sends the old connection a
// "superseded" message and then closes it with SUPERSEDED_CLOSE_CODE. (The
// message is what clients act on; Node's built-in WebSocket sometimes never
// reports a server-initiated close, and the code alone would be lost with
// it.) The old window then waits in standby: it keeps
// re-pairing with auth.standby = true, which the server refuses with
// "in_use" while another window holds it, so the two never take turns
// knocking each other off. When the holder goes away, the next standby
// attempt succeeds. Both additions are optional fields a peer that doesn't
// know them ignores, so they didn't need a protocol version bump.
//
// Both proofs are bound to the port the connection is on (the client uses
// the port it dialled, the server the port it bound). Only one process can
// own 127.0.0.1:<port>, so a squatter on one port can't relay the handshake
// to a genuine server on another port and pass its proof off as its own.
// The "server"/"client" role labels stop one side's proof being reflected
// back as the other's.

/**
 * Bump on ANY wire change, so mismatched peers fail with a clear
 * "protocol_mismatch" rather than half-working. v1 (no version field) sent
 * the token in the clear.
 */
export const BRIDGE_PROTOCOL_VERSION = 2;

/** First message the client sends after connecting. Carries no secret. */
export interface HelloMessage {
  type: "hello";
  protocolVersion: number;
  /** 32 random bytes, lowercase hex. */
  clientNonce: string;
  appVersion?: string;
}

/** Server's reply to hello: its own nonce plus proof that it holds the token. */
export interface ChallengeMessage {
  type: "challenge";
  protocolVersion: number;
  /** 32 random bytes, lowercase hex. */
  serverNonce: string;
  /** Lowercase hex HMAC-SHA256(token, proofInput("server", ...)). */
  serverProof: string;
}

/** Client's proof, sent only after it has verified the server's. */
export interface AuthMessage {
  type: "auth";
  /** Lowercase hex HMAC-SHA256(token, proofInput("client", ...)). */
  clientProof: string;
  /**
   * Pair only if no other Open Keep window is paired with this server;
   * otherwise the server answers hello_ack {ok: false, reason: "in_use"}
   * instead of taking the connection over. Sent by a window that was
   * superseded (see SUPERSEDED_CLOSE_CODE).
   */
  standby?: boolean;
}

/**
 * Why a server ended the handshake:
 *  - protocol_mismatch: the peer speaks a different BRIDGE_PROTOCOL_VERSION
 *  - bad_proof: the client's proof didn't match this server's token
 *  - bad_message: a malformed or out-of-order handshake message
 *  - in_use: the client asked for standby and another window holds this
 *    server (only ever sent after the client's proof checked out)
 * A v1 server answers a v2 hello with "bad_token".
 */
export type HelloAckReason = "protocol_mismatch" | "bad_proof" | "bad_message" | "in_use";

export interface HelloAck {
  type: "hello_ack";
  ok: boolean;
  reason?: HelloAckReason | string;
  protocolVersion?: number;
}

/**
 * Sent to a paired connection, just before it is closed, when another Open
 * Keep window has paired and taken over. A client that gets it goes to
 * standby rather than redialling to take the server back.
 */
export interface SupersededMessage {
  type: "superseded";
}

/** Close code that follows SupersededMessage; a client treats it the same way. */
export const SUPERSEDED_CLOSE_CODE = 4001;

/** True for a 32-byte value in lowercase hex -- the shape of every nonce and proof. */
export function isHex32(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

/**
 * The exact bytes (UTF-8) each side HMACs with the pairing token as key.
 * Must be byte-identical on both sides of the bridge.
 */
export function proofInput(
  role: "server" | "client",
  port: number,
  clientNonce: string,
  serverNonce: string
): string {
  return `openkeep-bridge/v${BRIDGE_PROTOCOL_VERSION}|${role}|127.0.0.1:${port}|${clientNonce}|${serverNonce}`;
}

export type InboundMessage = ChallengeMessage | HelloAck | BridgeRequest | SupersededMessage;
export type OutboundMessage = HelloMessage | AuthMessage | BridgeResponse;

export class BridgeError extends Error {
  code: BridgeErrorCode;
  constructor(code: BridgeErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "BridgeError";
  }
}
