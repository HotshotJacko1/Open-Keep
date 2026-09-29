// Wire protocol between the Open Keep MCP server (this package) and an
// Open Keep client — today a browser tab at app.openkeep.net, later
// potentially a native PC app. Whichever is running connects OUT to this
// server's WebSocket listener (a browser tab can never open its own
// listening socket), completes a mutual challenge-response over a shared
// pairing token (the token itself never crosses the wire -- see the
// handshake block below), and then answers "request" messages with
// "response" messages.
//
// Hand-synced mirror of the app's src/lib/mcp-bridge/protocol.ts: keep the
// handshake block and the request/response shapes identical on both sides.
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
}

/**
 * Why a server ended the handshake:
 *  - protocol_mismatch: the peer speaks a different BRIDGE_PROTOCOL_VERSION
 *  - bad_proof: the client's proof didn't match this server's token
 *  - bad_message: a malformed or out-of-order handshake message
 * A v1 server answers a v2 hello with "bad_token".
 */
export type HelloAckReason = "protocol_mismatch" | "bad_proof" | "bad_message";

export interface HelloAck {
  type: "hello_ack";
  ok: boolean;
  reason?: HelloAckReason | string;
  protocolVersion?: number;
}

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

export type InboundMessage = HelloMessage | AuthMessage | BridgeResponse;
export type OutboundMessage = ChallengeMessage | HelloAck | BridgeRequest;
