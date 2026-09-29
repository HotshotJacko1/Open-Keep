// Copyright (c) 2026. Licensed under AGPLv3.
//
// Browser side of the Open Keep MCP bridge's WebSocket connections. Each
// MCP client (Claude Desktop, Claude Code, ...) runs its OWN copy of the
// local MCP server, and each copy takes the first free port from a small
// range -- so this class keeps one connection per live port rather than a
// single one, and answers "request" messages arriving on any of them.
//
// A browser tab can never open its own listening socket (see the PRD's
// Architecture section), so every connection is dialled out from here. That
// means whatever happens to be listening on a port gets dialled too, so the
// server has to PROVE it holds the pairing token before this side sends
// anything derived from it or serves a single request (see the handshake
// block in protocol.ts). The token itself never goes on the wire.
import {
  BRIDGE_PROTOCOL_VERSION,
  isHex32,
  proofInput,
  type AuthMessage,
  type BridgeRequest,
  type BridgeResponse,
  type HelloMessage,
  type InboundMessage,
} from "./protocol";

export type ConnectionState = "disconnected" | "connecting" | "connected" | "rejected";

/**
 * Why a port was given up on (only meaningful while the state is "rejected"):
 *  - "untrusted": whatever is listening couldn't prove it holds this pairing
 *    token -- the AI tool has a different/old token, or it isn't the Open
 *    Keep MCP server at all. Either way nothing secret was sent to it.
 *  - "incompatible": the server speaks a different bridge protocol version
 *    (or this browser lacks WebCrypto), so no handshake is possible.
 */
export type RejectReason = "untrusted" | "incompatible";

export type RequestHandler = (request: BridgeRequest) => Promise<BridgeResponse>;

export type StateListener = (
  state: ConnectionState,
  connectedCount: number,
  rejectReason: RejectReason | null
) => void;

/** Must match PORT_SPAN in the MCP server package. */
export const PORT_SPAN = 5;

/** A port that has answered before is worth retrying promptly. */
const RETRY_DELAY_MS = 4000;
/** A port nothing has ever answered on gets a lazy sweep, to stay quiet. */
const SWEEP_DELAY_MS = 30000;
/** A server that accepts the socket but never finishes the handshake is dropped. */
const HANDSHAKE_TIMEOUT_MS = 10000;

export interface McpBridgeClientOptions {
  retryDelayMs?: number;
  sweepDelayMs?: number;
  handshakeTimeoutMs?: number;
}

/**
 * Where a connection is in the v2 handshake (see protocol.ts):
 *  - "challenge": hello sent, waiting for the server's nonce + proof
 *  - "verifying": checking the server's proof; nothing may arrive meanwhile
 *  - "ack": our proof sent, waiting for hello_ack
 *  - "authed": handshake done; requests are served from here on only
 */
type Phase = "challenge" | "verifying" | "ack" | "authed";

interface Peer {
  socket: WebSocket;
  phase: Phase;
  clientNonce: string;
  handshakeTimer: ReturnType<typeof setTimeout> | null;
}

function randomHex32(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export class McpBridgeClient {
  private peers = new Map<number, Peer>();
  private timers = new Map<number, ReturnType<typeof setTimeout>>();
  /** Ports that have completed a handshake at least once this session. */
  private known = new Set<number>();
  private handler: RequestHandler | null = null;
  /** HMAC key for the current token. Non-extractable; the raw token is never sent. */
  private key: Promise<CryptoKey> | null = null;
  private ports: number[] = [];
  private wanted = false;
  /**
   * Ports given up on for this token, and why. Terminal: a refused port is
   * never redialled until connect() runs again (a new token, a switch
   * toggled, or an explicit retry). Redialling on a timer is exactly what a
   * squatter on the port would want, and a stale instance won't start
   * holding the right token by itself either.
   *
   * Instances can legitimately hold DIFFERENT tokens -- one left running
   * from before the token was changed, or a second AI tool configured
   * separately -- so a refusal stays local to that port; other ports keep
   * working.
   */
  private refused = new Map<number, RejectReason>();
  private state: ConnectionState = "disconnected";
  private readonly retryDelayMs: number;
  private readonly sweepDelayMs: number;
  private readonly handshakeTimeoutMs: number;

  constructor(private onStateChange: StateListener, options: McpBridgeClientOptions = {}) {
    this.retryDelayMs = options.retryDelayMs ?? RETRY_DELAY_MS;
    this.sweepDelayMs = options.sweepDelayMs ?? SWEEP_DELAY_MS;
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
  }

  connect(token: string, basePort: number, handler: RequestHandler): void {
    this.teardown();
    this.handler = handler;
    this.key = this.importKey(token);
    // Swallowed here; each handshake awaits it and fails that port if it rejected.
    this.key.catch(() => undefined);
    this.ports = Array.from({ length: PORT_SPAN }, (_, i) => basePort + i);
    this.wanted = true;
    this.refused.clear();
    for (const port of this.ports) this.openPort(port);
    this.recompute();
  }

  disconnect(): void {
    this.teardown();
    this.refused.clear();
    this.key = null;
    this.recompute();
  }

  getState(): ConnectionState {
    return this.state;
  }

  getConnectedCount(): number {
    let n = 0;
    for (const peer of this.peers.values()) if (peer.phase === "authed") n += 1;
    return n;
  }

  private importKey(token: string): Promise<CryptoKey> {
    // crypto.subtle only exists in secure contexts (https / localhost).
    if (typeof crypto === "undefined" || !crypto.subtle) {
      return Promise.reject(new Error("WebCrypto is unavailable in this context"));
    }
    return crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(token),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"]
    );
  }

  /** Detaches a socket's handlers and closes it, so it can't fire anything later. */
  private dropSocket(peer: Peer): void {
    if (peer.handshakeTimer) clearTimeout(peer.handshakeTimer);
    peer.handshakeTimer = null;
    // Detach first, so a late close event can't clobber the next
    // connection's state right after it opens.
    peer.socket.onclose = null;
    peer.socket.onerror = null;
    peer.socket.onmessage = null;
    peer.socket.onopen = null;
    peer.socket.close();
  }

  /** Drops every socket and pending retry without emitting a state change. */
  private teardown(): void {
    this.wanted = false;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const peer of this.peers.values()) this.dropSocket(peer);
    this.peers.clear();
  }

  private openPort(port: number): void {
    if (!this.wanted || this.peers.has(port) || this.refused.has(port)) return;

    let socket: WebSocket;
    try {
      socket = new WebSocket(`ws://127.0.0.1:${port}`);
    } catch {
      this.scheduleRetry(port);
      return;
    }

    const peer: Peer = { socket, phase: "challenge", clientNonce: randomHex32(), handshakeTimer: null };
    this.peers.set(port, peer);

    socket.onopen = () => {
      // No secret here: just a fresh nonce the server has to prove the token over.
      const hello: HelloMessage = {
        type: "hello",
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        clientNonce: peer.clientNonce,
        appVersion: "open-keep-web",
      };
      socket.send(JSON.stringify(hello));
      // Something that accepts the socket and then stalls gets dropped and
      // retried normally -- it has received nothing worth having.
      peer.handshakeTimer = setTimeout(() => {
        peer.handshakeTimer = null;
        if (peer.phase !== "authed") socket.close();
      }, this.handshakeTimeoutMs);
    };

    socket.onmessage = (event) => {
      let msg: InboundMessage;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object") return;
      void this.handleMessage(port, peer, msg);
    };

    socket.onclose = () => {
      // Most ports in the range have nothing behind them; that is the
      // normal case, not a failure worth surfacing.
      if (peer.handshakeTimer) clearTimeout(peer.handshakeTimer);
      peer.handshakeTimer = null;
      if (this.peers.get(port) === peer) this.peers.delete(port);
      this.recompute();
      this.scheduleRetry(port);
    };

    socket.onerror = () => {
      // onclose always follows; retry is handled there.
    };
  }

  private scheduleRetry(port: number): void {
    if (!this.wanted || this.timers.has(port) || this.refused.has(port)) return;
    const delay = this.known.has(port) ? this.retryDelayMs : this.sweepDelayMs;
    this.timers.set(
      port,
      setTimeout(() => {
        this.timers.delete(port);
        this.openPort(port);
      }, delay)
    );
  }

  /**
   * Gives up on a port for this token: closes it without sending anything
   * further and never redials it on a timer (see `refused`).
   */
  private refuse(port: number, peer: Peer, reason: RejectReason): void {
    this.refused.set(port, reason);
    if (this.peers.get(port) === peer) this.peers.delete(port);
    this.dropSocket(peer);
    this.recompute();
  }

  /** True while `peer` is still this port's live, open connection. */
  private isCurrent(port: number, peer: Peer): boolean {
    return this.peers.get(port) === peer && peer.socket.readyState === WebSocket.OPEN;
  }

  /**
   * State is derived from the peers rather than set at each event, so it
   * can't drift when several ports open and close independently.
   */
  private recompute(): void {
    let next: ConnectionState;
    let rejectReason: RejectReason | null = null;
    const count = this.getConnectedCount();
    const connecting =
      this.wanted &&
      [...this.peers.values()].some(
        (p) => p.socket.readyState === WebSocket.CONNECTING || p.socket.readyState === WebSocket.OPEN
      );

    if (count > 0) {
      next = "connected";
    } else if (this.refused.size > 0) {
      // Nothing is paired and something we reached failed the handshake.
      // That is terminal for that port, so keep reporting it while the
      // other ports are still being swept rather than flickering back to
      // "connecting".
      next = "rejected";
      rejectReason = [...this.refused.values()].includes("incompatible") ? "incompatible" : "untrusted";
    } else if (connecting) {
      next = "connecting";
    } else {
      next = "disconnected";
    }

    this.state = next;
    this.onStateChange(next, count, rejectReason);
  }

  private async handleMessage(port: number, peer: Peer, msg: InboundMessage): Promise<void> {
    if (!this.isCurrent(port, peer)) return;

    switch (peer.phase) {
      case "challenge": {
        if (msg.type === "hello_ack" && !msg.ok) {
          // A v2 server says protocol_mismatch; a v1 server can't read our
          // hello and says bad_token. Neither was sent anything secret.
          const incompatible = msg.reason === "protocol_mismatch" || msg.reason === "bad_token";
          this.refuse(port, peer, incompatible ? "incompatible" : "untrusted");
          return;
        }
        if (msg.type !== "challenge") {
          // Anything else here -- an unearned hello_ack {ok:true}, a request
          // -- is a server that won't prove the token. Never serve it.
          this.refuse(port, peer, "untrusted");
          return;
        }
        if (msg.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
          this.refuse(port, peer, "incompatible");
          return;
        }
        if (!isHex32(msg.serverNonce) || !isHex32(msg.serverProof)) {
          this.refuse(port, peer, "untrusted");
          return;
        }

        peer.phase = "verifying";
        const serverNonce = msg.serverNonce;
        let clientProof: string;
        try {
          const key = await this.key!;
          // subtle.verify does the comparison itself, without an early-exit
          // byte compare in our code.
          const ok = await crypto.subtle.verify(
            "HMAC",
            key,
            hexToBytes(msg.serverProof),
            new TextEncoder().encode(proofInput("server", port, peer.clientNonce, serverNonce))
          );
          if (!this.isCurrent(port, peer) || peer.phase !== "verifying") return;
          if (!ok) {
            this.refuse(port, peer, "untrusted");
            return;
          }
          clientProof = bytesToHex(
            await crypto.subtle.sign(
              "HMAC",
              key,
              new TextEncoder().encode(proofInput("client", port, peer.clientNonce, serverNonce))
            )
          );
        } catch {
          if (this.peers.get(port) === peer) this.refuse(port, peer, "incompatible");
          return;
        }
        if (!this.isCurrent(port, peer) || peer.phase !== "verifying") return;

        const auth: AuthMessage = { type: "auth", clientProof };
        peer.phase = "ack";
        peer.socket.send(JSON.stringify(auth));
        return;
      }

      case "verifying":
        // A genuine server has nothing to say while we check its proof.
        this.refuse(port, peer, "untrusted");
        return;

      case "ack": {
        if (msg.type === "hello_ack" && msg.ok) {
          peer.phase = "authed";
          if (peer.handshakeTimer) clearTimeout(peer.handshakeTimer);
          peer.handshakeTimer = null;
          this.known.add(port);
          this.recompute();
          return;
        }
        // It proved the token, then refused ours or sent something else.
        this.refuse(port, peer, "untrusted");
        return;
      }

      case "authed": {
        // Requests are served only on a connection that finished the handshake.
        if (msg.type === "request" && this.handler) {
          const response = await this.handler(msg);
          if (this.isCurrent(port, peer)) {
            peer.socket.send(JSON.stringify(response));
          }
        }
        return;
      }
    }
  }
}
