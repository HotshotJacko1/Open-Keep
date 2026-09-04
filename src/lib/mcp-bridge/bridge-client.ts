// Copyright (c) 2026. Licensed under AGPLv3.
//
// Browser side of the Open Keep MCP bridge's WebSocket connection. The
// local MCP server process listens on 127.0.0.1; this class connects OUT
// to it (a browser tab can never open its own listening socket -- see the
// PRD's Architecture section), authenticates once with the pairing token,
// and then answers "request" messages by calling the handler passed to
// `connect()`.
import type { BridgeRequest, BridgeResponse, HelloAck, InboundMessage } from "./protocol";

export type ConnectionState = "disconnected" | "connecting" | "connected" | "rejected";

export type RequestHandler = (request: BridgeRequest) => Promise<BridgeResponse>;

const RECONNECT_DELAY_MS = 4000;

export class McpBridgeClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private handler: RequestHandler | null = null;
  private state: ConnectionState = "disconnected";
  private token = "";
  private port = 8420;
  private wanted = false; // true while the user has this turned on

  constructor(private onStateChange: (state: ConnectionState) => void) {}

  connect(token: string, port: number, handler: RequestHandler): void {
    this.token = token;
    this.port = port;
    this.handler = handler;
    this.wanted = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Reconnecting (e.g. the user pasted a new token while already
    // connected) -- detach the stale socket's handlers first so its close
    // event can't clobber the new connection's state right after it opens.
    if (this.ws) {
      const stale = this.ws;
      this.ws = null;
      stale.onclose = null;
      stale.onerror = null;
      stale.onmessage = null;
      stale.close();
    }

    this.open();
  }

  disconnect(): void {
    this.wanted = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.setState("disconnected");
  }

  private setState(state: ConnectionState): void {
    this.state = state;
    this.onStateChange(state);
  }

  getState(): ConnectionState {
    return this.state;
  }

  private open(): void {
    if (!this.wanted) return;
    this.setState("connecting");

    let socket: WebSocket;
    try {
      socket = new WebSocket(`ws://127.0.0.1:${this.port}`);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;

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
      this.handleMessage(msg);
    };

    socket.onclose = () => {
      if (this.state !== "rejected") this.setState("disconnected");
      this.ws = null;
      if (this.wanted && this.state !== "rejected") this.scheduleReconnect();
    };

    socket.onerror = () => {
      // onclose fires right after; reconnect handled there.
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.wanted) this.open();
    }, RECONNECT_DELAY_MS);
  }

  private async handleMessage(msg: InboundMessage): Promise<void> {
    if (msg.type === "hello_ack") {
      const ack = msg as HelloAck;
      if (ack.ok) {
        this.setState("connected");
      } else {
        // A wrong/stale token won't fix itself by retrying.
        this.setState("rejected");
        this.wanted = false;
        this.ws?.close();
      }
      return;
    }

    if (msg.type === "request" && this.handler) {
      const request = msg as BridgeRequest;
      const response = await this.handler(request);
      this.ws?.send(JSON.stringify(response));
    }
  }
}
