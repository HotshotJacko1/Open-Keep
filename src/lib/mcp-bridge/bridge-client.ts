// Copyright (c) 2026. Licensed under AGPLv3.
//
// Browser side of the Open Keep MCP bridge's WebSocket connections. Each
// MCP client (Claude Desktop, Claude Code, ...) runs its OWN copy of the
// local MCP server, and each copy takes the first free port from a small
// range -- so this class keeps one connection per live port rather than a
// single one, and answers "request" messages arriving on any of them.
//
// A browser tab can never open its own listening socket (see the PRD's
// Architecture section), so every connection is dialled out from here.
import type { BridgeRequest, BridgeResponse, HelloAck, InboundMessage } from "./protocol";

export type ConnectionState = "disconnected" | "connecting" | "connected" | "rejected";

export type RequestHandler = (request: BridgeRequest) => Promise<BridgeResponse>;

export type StateListener = (state: ConnectionState, connectedCount: number) => void;

/** Must match PORT_SPAN in the MCP server package. */
export const PORT_SPAN = 5;

/** A port that has answered before is worth retrying promptly. */
const RETRY_DELAY_MS = 4000;
/** A port nothing has ever answered on gets a lazy sweep, to stay quiet. */
const SWEEP_DELAY_MS = 30000;

interface Peer {
  socket: WebSocket;
  authed: boolean;
}

export class McpBridgeClient {
  private peers = new Map<number, Peer>();
  private timers = new Map<number, ReturnType<typeof setTimeout>>();
  /** Ports that have completed a handshake at least once this session. */
  private known = new Set<number>();
  private handler: RequestHandler | null = null;
  private token = "";
  private ports: number[] = [];
  private wanted = false;
  /**
   * Ports whose server refused this token. Instances can legitimately hold
   * DIFFERENT tokens -- one left running from before the token was changed,
   * or a second AI tool configured separately -- so a refusal has to stay
   * local to that port. Poisoning every connection because one stale
   * instance said no is how a working bridge ends up showing "rejected".
   */
  private refused = new Set<number>();
  private state: ConnectionState = "disconnected";

  constructor(private onStateChange: StateListener) {}

  connect(token: string, basePort: number, handler: RequestHandler): void {
    this.teardown();
    this.token = token;
    this.handler = handler;
    this.ports = Array.from({ length: PORT_SPAN }, (_, i) => basePort + i);
    this.wanted = true;
    this.refused.clear();
    for (const port of this.ports) this.openPort(port);
    this.recompute();
  }

  disconnect(): void {
    this.teardown();
    this.recompute();
  }

  getState(): ConnectionState {
    return this.state;
  }

  getConnectedCount(): number {
    let n = 0;
    for (const peer of this.peers.values()) if (peer.authed) n += 1;
    return n;
  }

  /** Drops every socket and pending retry without emitting a state change. */
  private teardown(): void {
    this.wanted = false;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const peer of this.peers.values()) {
      // Detach first, so a late close event can't clobber the next
      // connection's state right after it opens.
      peer.socket.onclose = null;
      peer.socket.onerror = null;
      peer.socket.onmessage = null;
      peer.socket.onopen = null;
      peer.socket.close();
    }
    this.peers.clear();
  }

  private openPort(port: number): void {
    if (!this.wanted || this.peers.has(port)) return;

    let socket: WebSocket;
    try {
      socket = new WebSocket(`ws://127.0.0.1:${port}`);
    } catch {
      this.scheduleRetry(port);
      return;
    }

    const peer: Peer = { socket, authed: false };
    this.peers.set(port, peer);

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: "hello", token: this.token, appVersion: "open-keep-web" }));
    };

    socket.onmessage = (event) => {
      let msg: InboundMessage;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }
      void this.handleMessage(port, msg);
    };

    socket.onclose = () => {
      // Most ports in the range have nothing behind them; that is the
      // normal case, not a failure worth surfacing.
      if (this.peers.get(port) === peer) this.peers.delete(port);
      this.recompute();
      this.scheduleRetry(port);
    };

    socket.onerror = () => {
      // onclose always follows; retry is handled there.
    };
  }

  private scheduleRetry(port: number): void {
    if (!this.wanted || this.timers.has(port)) return;
    // A port that refused us gets the lazy cadence, so it can recover if that
    // tool's token is fixed later without spamming refusals in between.
    const delay = this.known.has(port) && !this.refused.has(port) ? RETRY_DELAY_MS : SWEEP_DELAY_MS;
    this.timers.set(
      port,
      setTimeout(() => {
        this.timers.delete(port);
        this.openPort(port);
      }, delay)
    );
  }

  /**
   * State is derived from the peers rather than set at each event, so it
   * can't drift when several ports open and close independently.
   */
  private recompute(): void {
    let next: ConnectionState;
    const connecting =
      this.wanted &&
      [...this.peers.values()].some(
        (p) => p.socket.readyState === WebSocket.CONNECTING || p.socket.readyState === WebSocket.OPEN
      );

    if (this.getConnectedCount() > 0) {
      next = "connected";
    } else if (this.refused.size > 0 && !connecting) {
      // Nothing is paired and everything we reached said no -- that is worth
      // reporting as a bad token rather than a silent "not connected".
      next = "rejected";
    } else if (connecting) {
      next = "connecting";
    } else {
      next = "disconnected";
    }

    const count = this.getConnectedCount();
    this.state = next;
    this.onStateChange(next, count);
  }

  private async handleMessage(port: number, msg: InboundMessage): Promise<void> {
    const peer = this.peers.get(port);
    if (!peer) return;

    if (msg.type === "hello_ack") {
      const ack = msg as HelloAck;
      if (ack.ok) {
        peer.authed = true;
        this.known.add(port);
        this.refused.delete(port);
        this.recompute();
      } else {
        // Only this instance said no. Drop this one socket and leave every
        // other port alone -- another instance may well accept the token.
        this.refused.add(port);
        peer.socket.close();
      }
      return;
    }

    if (msg.type === "request" && this.handler) {
      const request = msg as BridgeRequest;
      const response = await this.handler(request);
      if (peer.socket.readyState === WebSocket.OPEN) {
        peer.socket.send(JSON.stringify(response));
      }
    }
  }
}
