import { WebSocketServer, WebSocket, type RawData } from "ws";
import { randomUUID } from "node:crypto";
import type {
  BridgeOp,
  BridgeRequest,
  InboundMessage,
} from "./protocol.js";

const REQUEST_TIMEOUT_MS = 8000;

export class BridgeNotConnectedError extends Error {
  constructor() {
    super(
      'Open Keep is not connected. Open app.openkeep.net in a browser and turn on "Let AI read/edit notes" in Settings > AI Assistant Access.'
    );
    this.name = "BridgeNotConnectedError";
  }
}

interface PendingCall {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Hosts the local WebSocket listener that an Open Keep client (today: the
 * browser tab; later: a possible native app) connects OUT to, since a
 * browser can never open its own listening socket. Exactly one connection
 * is treated as "the" active bridge at a time — a newer authenticated
 * connection replaces an older one.
 */
export class BridgeServer {
  private readonly wss: WebSocketServer;
  private socket: WebSocket | null = null;
  private readonly pending = new Map<string, PendingCall>();

  constructor(private readonly token: string, port: number) {
    this.wss = new WebSocketServer({ port, host: "127.0.0.1" });
    this.wss.on("connection", (ws) => this.handleConnection(ws));
    this.wss.on("error", (err) => {
      process.stderr.write(`[openkeep-mcp] bridge server error: ${err.message}\n`);
    });
    process.stderr.write(`[openkeep-mcp] Bridge listening on ws://127.0.0.1:${port}\n`);
  }

  private handleConnection(ws: WebSocket): void {
    let authed = false;

    ws.on("message", (raw: RawData) => {
      let msg: InboundMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === "hello") {
        authed = msg.token === this.token;
        ws.send(JSON.stringify({ type: "hello_ack", ok: authed, reason: authed ? undefined : "bad_token" }));
        if (!authed) {
          ws.close();
          return;
        }
        // Only one client counts as "connected" at a time — a fresh
        // authenticated connection (e.g. the tab was reloaded) replaces
        // whatever was there before rather than stacking up.
        if (this.socket && this.socket !== ws) this.socket.close();
        this.socket = ws;
        return;
      }

      if (!authed) return;

      if (msg.type === "response") {
        const pending = this.pending.get(msg.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(msg.id);
        if (msg.ok) {
          pending.resolve(msg.data);
        } else {
          pending.reject(Object.assign(new Error(msg.error.message), { code: msg.error.code }));
        }
      }
    });

    ws.on("close", () => {
      if (this.socket === ws) this.socket = null;
    });
  }

  isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  /** Sends one op to the connected client and awaits its response. */
  async call(op: BridgeOp, params: Record<string, unknown>): Promise<unknown> {
    if (!this.isConnected()) throw new BridgeNotConnectedError();

    const id = randomUUID();
    const request: BridgeRequest = { type: "request", id, op, params };

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Timed out waiting for Open Keep to respond."));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timer });
      this.socket!.send(JSON.stringify(request));
    });
  }

  close(): void {
    this.wss.close();
  }
}
