import { WebSocketServer, WebSocket, type RawData } from "ws";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  BRIDGE_PROTOCOL_VERSION,
  isHex32,
  proofInput,
  type BridgeOp,
  type BridgeRequest,
  type ChallengeMessage,
  type HelloAck,
  type HelloAckReason,
  type InboundMessage,
} from "./protocol.js";

const REQUEST_TIMEOUT_MS = 8000;
/** A connection that hasn't finished the handshake by now is dropped. */
const HANDSHAKE_TIMEOUT_MS = 10000;

function hmacHex(token: string, input: string): string {
  return createHmac("sha256", token).update(input, "utf8").digest("hex");
}

/** How many consecutive ports an instance will try before giving up. */
export const PORT_SPAN = 5;

export class BridgeNotConnectedError extends Error {
  constructor(detail?: string) {
    super(
      'Open Keep is not connected. Open app.openkeep.net in a browser and turn on "Let AI read/edit notes" in Settings > AI Assistant Access.' +
        (detail ? ` ${detail}` : "")
    );
    this.name = "BridgeNotConnectedError";
  }
}

/**
 * Raised when this process never managed to bind its port. That is fatal:
 * the app can never reach this server, so every tool call would otherwise
 * report the misleading "Open Keep is not connected" forever, while the app
 * itself sits there showing a happy green dot because it is talking to
 * whichever other process actually owns the port.
 */
export class BridgePortUnavailableError extends Error {
  constructor(ports: number[], cause: NodeJS.ErrnoException) {
    const range = `${ports[0]}-${ports[ports.length - 1]}`;
    super(
      cause.code === "EADDRINUSE"
        ? `Every port in ${range} is already taken, so this copy of the Open Keep MCP server has nowhere to listen and can never receive a connection from the app. Open Keep may well show "Connected", because it is connected to another copy, not this one. Close an AI tool that is using Open Keep, or widen the range with OPENKEEP_MCP_PORT.`
        : `The Open Keep MCP server could not listen on ports ${range}: ${cause.message}`
    );
    this.name = "BridgePortUnavailableError";
  }
}

/**
 * Resolves once the server is listening, or rejects with the bind error.
 * `ws` binds in its constructor, so trying the next port means building a
 * fresh WebSocketServer rather than retrying this one.
 */
function listenOn(port: number): Promise<WebSocketServer> {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port, host: "127.0.0.1" });
    const onError = (err: Error) => {
      wss.close();
      reject(err);
    };
    wss.once("error", onError);
    wss.once("listening", () => {
      wss.off("error", onError);
      resolve(wss);
    });
  });
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
  private wss: WebSocketServer | null = null;
  private socket: WebSocket | null = null;
  private readonly pending = new Map<string, PendingCall>();
  /**
   * Set when an app tab speaking another protocol version tried to pair, so
   * a tool call can say "update one side" instead of a bare "not connected".
   */
  private sawProtocolMismatch = false;

  private boundPort: number | null = null;
  private listenError: NodeJS.ErrnoException | null = null;
  private readonly ports: number[];
  /** Resolves once binding has been attempted, so an early call() doesn't race it. */
  readonly ready: Promise<void>;

  constructor(private readonly token: string, basePort: number, span = PORT_SPAN) {
    this.ports = Array.from({ length: span }, (_, i) => basePort + i);
    this.ready = this.bindFirstFree();
  }

  /**
   * Every MCP client that starts Open Keep spawns its own copy of this
   * server, and only one of them can own a given port — so instead of
   * fighting over a fixed one, each takes the first port free in a small
   * range and the app connects to all of them. No instance depends on any
   * other's lifetime.
   */
  private async bindFirstFree(): Promise<void> {
    for (const port of this.ports) {
      try {
        const wss = await listenOn(port);
        this.wss = wss;
        this.boundPort = port;
        wss.on("connection", (ws) => this.handleConnection(ws));
        wss.on("error", (err: Error) => {
          process.stderr.write(`[openkeep-mcp] bridge server error: ${err.message}\n`);
        });
        process.stderr.write(`[openkeep-mcp] Bridge listening on ws://127.0.0.1:${port}\n`);
        return;
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e.code !== "EADDRINUSE") {
          this.listenError = e;
          process.stderr.write(`[openkeep-mcp] could not listen on ${port}: ${e.message}\n`);
          return;
        }
        // Taken by another copy of this server — try the next one along.
      }
    }
    this.listenError = Object.assign(new Error("no free port in range"), { code: "EADDRINUSE" });
    process.stderr.write(
      `[openkeep-mcp] no free port in ${this.ports[0]}-${this.ports[this.ports.length - 1]}; this instance cannot serve requests\n`
    );
  }

  /** The port this instance actually got, or null if it never bound one. */
  get port(): number | null {
    return this.boundPort;
  }

  /**
   * Runs the server half of the v2 handshake (see protocol.ts): answer the
   * client's nonce with our own nonce plus proof we hold the token, then
   * accept the connection only if the client's proof checks out. Nothing is
   * sent to, or accepted from, the client beyond that until it has proven
   * the token.
   */
  private handleConnection(ws: WebSocket): void {
    let phase: "hello" | "auth" | "authed" | "closed" = "hello";
    let clientNonce = "";
    let serverNonce = "";
    // Only ever called after a successful bind, so the port is known.
    const port = this.boundPort as number;

    const refuse = (reason: HelloAckReason) => {
      phase = "closed";
      clearTimeout(handshakeTimer);
      const ack: HelloAck = { type: "hello_ack", ok: false, reason, protocolVersion: BRIDGE_PROTOCOL_VERSION };
      ws.send(JSON.stringify(ack));
      ws.close();
    };

    const handshakeTimer = setTimeout(() => {
      if (phase !== "authed" && phase !== "closed") {
        phase = "closed";
        ws.close();
      }
    }, HANDSHAKE_TIMEOUT_MS);

    ws.on("message", (raw: RawData) => {
      let msg: InboundMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object") return;

      if (phase === "closed") return;

      if (phase === "hello") {
        if (msg.type !== "hello") return refuse("bad_message");
        if (msg.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
          this.sawProtocolMismatch = true;
          process.stderr.write(
            `[openkeep-mcp] refused an Open Keep tab speaking bridge protocol v${
              typeof msg.protocolVersion === "number" ? msg.protocolVersion : 1
            }; this server speaks v${BRIDGE_PROTOCOL_VERSION}. Update whichever side is older.
`
          );
          return refuse("protocol_mismatch");
        }
        if (!isHex32(msg.clientNonce)) return refuse("bad_message");
        clientNonce = msg.clientNonce;
        serverNonce = randomBytes(32).toString("hex");
        const challenge: ChallengeMessage = {
          type: "challenge",
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          serverNonce,
          serverProof: hmacHex(this.token, proofInput("server", port, clientNonce, serverNonce)),
        };
        phase = "auth";
        ws.send(JSON.stringify(challenge));
        return;
      }

      if (phase === "auth") {
        if (msg.type !== "auth" || !isHex32(msg.clientProof)) return refuse("bad_message");
        const expected = Buffer.from(hmacHex(this.token, proofInput("client", port, clientNonce, serverNonce)), "hex");
        const given = Buffer.from(msg.clientProof, "hex");
        // isHex32 already fixed both at 32 bytes, so timingSafeEqual can't throw.
        if (!timingSafeEqual(expected, given)) return refuse("bad_proof");

        phase = "authed";
        clearTimeout(handshakeTimer);
        this.sawProtocolMismatch = false;
        const ack: HelloAck = { type: "hello_ack", ok: true, protocolVersion: BRIDGE_PROTOCOL_VERSION };
        ws.send(JSON.stringify(ack));
        // Only one client counts as "connected" at a time — a fresh
        // authenticated connection (e.g. the tab was reloaded) replaces
        // whatever was there before rather than stacking up.
        if (this.socket && this.socket !== ws) this.socket.close();
        this.socket = ws;
        return;
      }

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
      phase = "closed";
      clearTimeout(handshakeTimer);
      if (this.socket === ws) this.socket = null;
    });
  }

  isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  /** Sends one op to the connected client and awaits its response. */
  async call(op: BridgeOp, params: Record<string, unknown>): Promise<unknown> {
    await this.ready;
    if (this.listenError) throw new BridgePortUnavailableError(this.ports, this.listenError);
    if (!this.isConnected()) {
      throw new BridgeNotConnectedError(
        this.sawProtocolMismatch
          ? "An Open Keep tab did try to connect, but it speaks a different bridge protocol version than this MCP server. Update the Open Keep extension/MCP server, and reload the Open Keep tab."
          : undefined
      );
    }

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
    this.wss?.close();
  }
}
