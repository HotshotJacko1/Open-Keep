// Copyright (c) 2026. Licensed under AGPLv3.
//
// The bridge half of the built-in relay: a WebSocket listener on 127.0.0.1
// that an Open Keep window (this app's WebView, or a browser tab) dials out
// to. A port of mcp-server/src/bridge-server.ts, speaking the same protocol
// (v2 handshake, one window at a time, standby). The wire format is defined
// in src/lib/mcp-bridge/protocol.ts and mcp-server/src/protocol.ts; this is
// the third hand-synced copy, so a protocol change has to land here too.
// mcp-server's `npm run test:relay` runs the Node server's protocol tests
// against this one.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use hmac::{Hmac, Mac};
use rand::RngCore;
use serde_json::{Value, json};
use sha2::Sha256;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;

pub const BRIDGE_PROTOCOL_VERSION: u64 = 2;
pub const SUPERSEDED_CLOSE_CODE: u16 = 4001;
/** How many consecutive ports an instance tries before giving up. */
pub const PORT_SPAN: u16 = 5;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);
/** A connection that hasn't finished the handshake by now is dropped. */
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);

type HmacSha256 = Hmac<Sha256>;

/// Where the pairing token comes from. Read again for every connection, so a
/// token regenerated in Settings applies without restarting the AI tool.
pub type TokenSource = Arc<dyn Fn() -> Option<String> + Send + Sync>;

pub fn log(msg: &str) {
    eprintln!("[openkeep-mcp] {msg}");
}

pub fn is_hex32(value: &Value) -> bool {
    value
        .as_str()
        .is_some_and(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)))
}

pub fn proof_input(role: &str, port: u16, client_nonce: &str, server_nonce: &str) -> String {
    format!("openkeep-bridge/v{BRIDGE_PROTOCOL_VERSION}|{role}|127.0.0.1:{port}|{client_nonce}|{server_nonce}")
}

fn hmac_for(token: &str, input: &str) -> HmacSha256 {
    let mut mac = HmacSha256::new_from_slice(token.as_bytes()).expect("HMAC takes a key of any length");
    mac.update(input.as_bytes());
    mac
}

pub fn hmac_hex(token: &str, input: &str) -> String {
    hex::encode(hmac_for(token, input).finalize().into_bytes())
}

fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    hex::encode(buf)
}

enum Outgoing {
    Text(String),
    Close(u16, &'static str),
}

struct Active {
    conn: u64,
    tx: mpsc::UnboundedSender<Outgoing>,
}

struct Pending {
    conn: u64,
    reply: oneshot::Sender<Result<Value, String>>,
}

pub struct Bridge {
    token: TokenSource,
    ports: Vec<u16>,
    bound_port: Mutex<Option<u16>>,
    listen_error: Mutex<Option<String>>,
    /// The one paired window requests go to.
    active: Mutex<Option<Active>>,
    pending: Mutex<HashMap<String, Pending>>,
    /// Set when a window speaking another protocol version tried to pair, so a
    /// tool call can say "update one side" instead of a bare "not connected".
    saw_protocol_mismatch: AtomicBool,
    next_conn: AtomicU64,
}

impl Bridge {
    pub fn new(token: TokenSource, base_port: u16) -> Arc<Self> {
        Arc::new(Self {
            token,
            ports: (0..PORT_SPAN).filter_map(|i| base_port.checked_add(i)).collect(),
            bound_port: Mutex::new(None),
            listen_error: Mutex::new(None),
            active: Mutex::new(None),
            pending: Mutex::new(HashMap::new()),
            saw_protocol_mismatch: AtomicBool::new(false),
            next_conn: AtomicU64::new(1),
        })
    }

    /// Takes the first free port in the range, as each MCP client runs its
    /// own copy of the relay (or of the Node server) and the app dials them all.
    pub async fn listen(self: &Arc<Self>) {
        for &port in &self.ports {
            match TcpListener::bind(("127.0.0.1", port)).await {
                Ok(listener) => {
                    *self.bound_port.lock().unwrap() = Some(port);
                    log(&format!("Bridge listening on ws://127.0.0.1:{port}"));
                    let bridge = Arc::clone(self);
                    tokio::spawn(async move {
                        loop {
                            match listener.accept().await {
                                Ok((stream, _)) => {
                                    let bridge = Arc::clone(&bridge);
                                    tokio::spawn(async move { bridge.handle_connection(stream, port).await });
                                }
                                Err(e) => log(&format!("bridge server error: {e}")),
                            }
                        }
                    });
                    return;
                }
                Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => continue,
                Err(e) => {
                    log(&format!("could not listen on {port}: {e}"));
                    *self.listen_error.lock().unwrap() = Some(format!(
                        "The Open Keep MCP server could not listen on ports {}: {e}",
                        self.range()
                    ));
                    return;
                }
            }
        }
        log(&format!("no free port in {}; this instance cannot serve requests", self.range()));
        *self.listen_error.lock().unwrap() = Some(format!(
            "Every port in {} is already taken, so this copy of the Open Keep MCP server has nowhere to listen and can never receive a connection from the app. Open Keep may well show \"Connected\", because it is connected to another copy, not this one. Close an AI tool that is using Open Keep, or widen the range with OPENKEEP_MCP_PORT.",
            self.range()
        ));
    }

    fn range(&self) -> String {
        format!("{}-{}", self.ports.first().unwrap_or(&0), self.ports.last().unwrap_or(&0))
    }

    #[cfg(test)]
    pub fn port(&self) -> Option<u16> {
        *self.bound_port.lock().unwrap()
    }

    fn is_connected(&self) -> bool {
        self.active.lock().unwrap().as_ref().is_some_and(|a| !a.tx.is_closed())
    }

    /// Runs the server half of the v2 handshake, then relays responses. See
    /// the handshake block in protocol.ts.
    async fn handle_connection(self: Arc<Self>, stream: TcpStream, port: u16) {
        let Ok(ws) = tokio_tungstenite::accept_async(stream).await else { return };
        let (mut sink, mut stream) = ws.split();
        let conn = self.next_conn.fetch_add(1, Ordering::Relaxed);

        // One writer per socket, so the handshake, requests from tool calls and
        // a takeover's "superseded" all go out in order.
        let (tx, mut rx) = mpsc::unbounded_channel::<Outgoing>();
        tokio::spawn(async move {
            while let Some(out) = rx.recv().await {
                match out {
                    Outgoing::Text(text) => {
                        if sink.send(Message::text(text)).await.is_err() {
                            break;
                        }
                    }
                    Outgoing::Close(code, reason) => {
                        let frame = CloseFrame { code: CloseCode::from(code), reason: reason.into() };
                        let _ = sink.send(Message::Close(Some(frame))).await;
                        break;
                    }
                }
            }
            let _ = sink.close().await;
        });

        let send = |value: Value| {
            let _ = tx.send(Outgoing::Text(value.to_string()));
        };
        let refuse = |reason: &str| {
            send(json!({ "type": "hello_ack", "ok": false, "reason": reason, "protocolVersion": BRIDGE_PROTOCOL_VERSION }));
            let _ = tx.send(Outgoing::Close(1000, ""));
        };

        // --- Handshake ---------------------------------------------------------
        let handshake = async {
            let mut client_nonce = String::new();
            let mut server_nonce = String::new();
            let mut token = String::new();
            while let Some(frame) = stream.next().await {
                let Ok(Message::Text(text)) = frame else {
                    if matches!(frame, Ok(Message::Close(_)) | Err(_)) {
                        return false;
                    }
                    continue;
                };
                let Ok(msg) = serde_json::from_str::<Value>(&text) else { continue };
                if !msg.is_object() {
                    continue;
                }
                let kind = msg.get("type").and_then(Value::as_str).unwrap_or("");

                if client_nonce.is_empty() {
                    if kind != "hello" {
                        refuse("bad_message");
                        return false;
                    }
                    let version = msg.get("protocolVersion").and_then(Value::as_u64);
                    if version != Some(BRIDGE_PROTOCOL_VERSION) {
                        self.saw_protocol_mismatch.store(true, Ordering::Relaxed);
                        log(&format!(
                            "refused an Open Keep window speaking bridge protocol v{}; this server speaks v{BRIDGE_PROTOCOL_VERSION}. Update whichever side is older.",
                            version.unwrap_or(1)
                        ));
                        refuse("protocol_mismatch");
                        return false;
                    }
                    let Some(nonce) = msg.get("clientNonce").filter(|v| is_hex32(v)).and_then(Value::as_str) else {
                        refuse("bad_message");
                        return false;
                    };
                    // No token yet (AI access never switched on in this app):
                    // nothing to prove, so hang up and let the window redial later.
                    let Some(current) = (self.token)() else {
                        let _ = tx.send(Outgoing::Close(1000, ""));
                        return false;
                    };
                    token = current;
                    client_nonce = nonce.to_string();
                    server_nonce = random_hex(32);
                    send(json!({
                        "type": "challenge",
                        "protocolVersion": BRIDGE_PROTOCOL_VERSION,
                        "serverNonce": server_nonce,
                        "serverProof": hmac_hex(&token, &proof_input("server", port, &client_nonce, &server_nonce)),
                    }));
                    continue;
                }

                let proof = msg.get("clientProof").filter(|v| is_hex32(v)).and_then(Value::as_str);
                let (true, Some(proof)) = (kind == "auth", proof) else {
                    refuse("bad_message");
                    return false;
                };
                let given = hex::decode(proof).unwrap_or_default();
                // Constant-time comparison.
                if hmac_for(&token, &proof_input("client", port, &client_nonce, &server_nonce))
                    .verify_slice(&given)
                    .is_err()
                {
                    refuse("bad_proof");
                    return false;
                }
                // A window in standby only pairs when nothing else holds this server.
                if msg.get("standby") == Some(&Value::Bool(true)) && self.is_connected() {
                    refuse("in_use");
                    return false;
                }
                return true;
            }
            false
        };
        let paired = matches!(tokio::time::timeout(HANDSHAKE_TIMEOUT, handshake).await, Ok(true));
        if !paired {
            let _ = tx.send(Outgoing::Close(1000, ""));
            return;
        }

        self.saw_protocol_mismatch.store(false, Ordering::Relaxed);
        send(json!({ "type": "hello_ack", "ok": true, "protocolVersion": BRIDGE_PROTOCOL_VERSION }));
        // Only one window counts as connected at a time. The newest takes over,
        // and the old one is told why so it waits in standby rather than
        // redialling to take the server back.
        let previous = self.active.lock().unwrap().replace(Active { conn, tx: tx.clone() });
        if let Some(old) = previous {
            let _ = old.tx.send(Outgoing::Text(json!({ "type": "superseded" }).to_string()));
            let _ = old.tx.send(Outgoing::Close(SUPERSEDED_CLOSE_CODE, "superseded"));
            self.fail_pending(old.conn);
        }

        // --- Paired: relay responses ---------------------------------------------
        while let Some(frame) = stream.next().await {
            let text = match frame {
                Ok(Message::Text(text)) => text,
                Ok(Message::Close(_)) | Err(_) => break,
                Ok(_) => continue,
            };
            let Ok(msg) = serde_json::from_str::<Value>(&text) else { continue };
            if msg.get("type").and_then(Value::as_str) != Some("response") {
                continue;
            }
            let Some(id) = msg.get("id").and_then(Value::as_str) else { continue };
            let pending = {
                let mut map = self.pending.lock().unwrap();
                match map.get(id) {
                    Some(p) if p.conn == conn => map.remove(id),
                    _ => None,
                }
            };
            let Some(pending) = pending else { continue };
            let result = if msg.get("ok") == Some(&Value::Bool(true)) {
                Ok(msg.get("data").cloned().unwrap_or(Value::Null))
            } else {
                Err(msg
                    .pointer("/error/message")
                    .and_then(Value::as_str)
                    .unwrap_or("Something went wrong.")
                    .to_string())
            };
            let _ = pending.reply.send(result);
        }

        {
            let mut active = self.active.lock().unwrap();
            if active.as_ref().is_some_and(|a| a.conn == conn) {
                *active = None;
            }
        }
        self.fail_pending(conn);
    }

    /// Fails the calls waiting on a connection whose answers can no longer
    /// arrive (another window took over, or it closed), at once rather than at
    /// the timeout.
    fn fail_pending(&self, conn: u64) {
        let orphaned: Vec<Pending> = {
            let mut map = self.pending.lock().unwrap();
            let ids: Vec<String> = map.iter().filter(|(_, p)| p.conn == conn).map(|(id, _)| id.clone()).collect();
            ids.into_iter().filter_map(|id| map.remove(&id)).collect()
        };
        for p in orphaned {
            let _ = p
                .reply
                .send(Err("The Open Keep window this request went to closed before answering. Try again.".into()));
        }
    }

    /// Sends one op to the paired window and waits for its answer.
    pub async fn call(&self, op: &str, params: Value) -> Result<Value, String> {
        if let Some(err) = self.listen_error.lock().unwrap().clone() {
            return Err(err);
        }
        let id = random_hex(16);
        let (reply, answer) = oneshot::channel();
        {
            let active = self.active.lock().unwrap();
            let Some(active) = active.as_ref().filter(|a| !a.tx.is_closed()) else {
                return Err(self.not_connected_message());
            };
            self.pending.lock().unwrap().insert(id.clone(), Pending { conn: active.conn, reply });
            let request = json!({ "type": "request", "id": id, "op": op, "params": params });
            let _ = active.tx.send(Outgoing::Text(request.to_string()));
        }
        match tokio::time::timeout(REQUEST_TIMEOUT, answer).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("The Open Keep window this request went to closed before answering. Try again.".into()),
            Err(_) => {
                self.pending.lock().unwrap().remove(&id);
                Err("Timed out waiting for Open Keep to respond.".into())
            }
        }
    }

    fn not_connected_message(&self) -> String {
        let mut msg = String::from(
            "Open Keep is not connected. Open the Open Keep desktop app, or app.openkeep.net in a browser, unlock it, and turn on \"Let AI read notes\" (and \"Let AI create, edit & delete notes\" for changes) in Settings > AI Assistant Access.",
        );
        if self.saw_protocol_mismatch.load(Ordering::Relaxed) {
            msg.push_str(" An Open Keep tab did try to connect, but it speaks a different bridge protocol version than this MCP server. Update the Open Keep extension/MCP server, and reload the Open Keep tab.");
        } else if (self.token)().is_none() {
            msg.push_str(" (Open Keep hasn't set up a pairing token on this computer yet: switching on either setting does that.)");
        }
        msg
    }
}
