// Copyright (c) 2026. Licensed under AGPLv3.
//
// `Open Keep.exe --mcp`: the app as its own MCP server, so an AI tool can use
// Open Keep with no separate install (no Node, no .mcpb). An AI tool starts
// this as a child process and talks MCP to it over stdin/stdout; it never
// opens a window or touches the database. Like the Node server in mcp-server/
// it only relays: the open Open Keep window (this app, or a browser tab)
// connects to it over the bridge (bridge.rs) and does the work, with its
// read/write switches, undo and tags.
//
// The pairing token comes from the running app through Windows Credential
// Manager (setup.rs keeps it there), so setting up a tool needs no token.
// OPENKEEP_MCP_TOKEN overrides it, e.g. to pair with a browser tab instead.

mod bridge;
pub mod setup;
mod tools;

use std::sync::Arc;

use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::mpsc;

use bridge::{Bridge, TokenSource, log};

pub(crate) const KEYRING_SERVICE: &str = "com.jackbarkerapps.openkeep";
#[cfg(not(test))]
pub(crate) const KEYRING_USER: &str = "mcp_pairing_token";
// Tests use their own entry, so they never touch a real token.
#[cfg(test)]
pub(crate) const KEYRING_USER: &str = "mcp_pairing_token_test";
const DEFAULT_PORT: u16 = 8420;
/// Same list, newest first, as the Node server's MCP SDK.
const SUPPORTED_PROTOCOL_VERSIONS: [&str; 5] = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07"];

/// True when the app was started as an MCP server rather than as the app.
pub fn requested() -> bool {
    std::env::args().skip(1).any(|a| a == "--mcp")
}

pub(crate) fn keyring_token() -> Option<String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .ok()?
        .get_password()
        .ok()
        .filter(|t| !t.is_empty())
}

fn token_source() -> TokenSource {
    match std::env::var("OPENKEEP_MCP_TOKEN").ok().map(|t| t.trim().to_string()).filter(|t| !t.is_empty()) {
        Some(token) => Arc::new(move || Some(token.clone())),
        None => Arc::new(keyring_token),
    }
}

/// The base of the port range, as in the Node server: anything that isn't a
/// usable port falls back to the default rather than binding a random one.
fn base_port() -> u16 {
    std::env::var("OPENKEEP_MCP_PORT")
        .ok()
        .and_then(|p| p.trim().parse::<u16>().ok())
        .filter(|&p| p > 0)
        .unwrap_or(DEFAULT_PORT)
}

/// Runs the MCP server until the AI tool closes stdin. Returns the exit code.
pub fn run() -> i32 {
    let runtime = match tokio::runtime::Builder::new_multi_thread().enable_all().build() {
        Ok(rt) => rt,
        Err(e) => {
            log(&format!("fatal: {e}"));
            return 1;
        }
    };
    runtime.block_on(serve());
    0
}

async fn serve() {
    let bridge = Bridge::new(token_source(), base_port());
    bridge.listen().await;

    // One writer, so concurrent tool calls never interleave their lines.
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
    let writer = tokio::spawn(async move {
        let mut stdout = tokio::io::stdout();
        while let Some(mut line) = out_rx.recv().await {
            line.push('\n');
            if stdout.write_all(line.as_bytes()).await.is_err() || stdout.flush().await.is_err() {
                break;
            }
        }
    });

    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let messages = match serde_json::from_str::<Value>(line) {
            Ok(Value::Array(batch)) => batch,
            Ok(msg) => vec![msg],
            Err(_) => {
                let _ = out_tx.send(error_response(Value::Null, -32700, "Parse error").to_string());
                continue;
            }
        };
        for msg in messages {
            // Requests run side by side: a slow tool call mustn't hold up a ping.
            let bridge = Arc::clone(&bridge);
            let out_tx = out_tx.clone();
            tokio::spawn(async move {
                if let Some(response) = handle(&bridge, msg).await {
                    let _ = out_tx.send(response.to_string());
                }
            });
        }
    }
    // stdin closed: the AI tool is done with us.
    drop(out_tx);
    let _ = tokio::time::timeout(std::time::Duration::from_secs(1), writer).await;
    std::process::exit(0);
}

fn error_response(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// Answers one JSON-RPC message. Notifications (no id) and responses get no reply.
async fn handle(bridge: &Bridge, msg: Value) -> Option<Value> {
    let id = msg.get("id").cloned().filter(|id| !id.is_null())?;
    let Some(method) = msg.get("method").and_then(Value::as_str) else { return None };
    let params = msg.get("params").cloned().unwrap_or(Value::Null);

    let result = match method {
        "initialize" => {
            let requested = params.get("protocolVersion").and_then(Value::as_str).unwrap_or("");
            let version = SUPPORTED_PROTOCOL_VERSIONS
                .iter()
                .find(|v| **v == requested)
                .unwrap_or(&SUPPORTED_PROTOCOL_VERSIONS[0]);
            json!({
                "protocolVersion": version,
                "capabilities": { "tools": { "listChanged": false } },
                "serverInfo": { "name": "open-keep", "title": "Open Keep", "version": env!("CARGO_PKG_VERSION") },
            })
        }
        "ping" => json!({}),
        "tools/list" => json!({ "tools": tools::list() }),
        "tools/call" => call_tool(bridge, &params).await,
        _ => return Some(error_response(id, -32601, "Method not found")),
    };
    Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

fn tool_error(message: impl Into<String>) -> Value {
    json!({ "content": [{ "type": "text", "text": message.into() }], "isError": true })
}

/// Every tool is one bridge op of the same name, as in mcp-server/src/server.ts.
async fn call_tool(bridge: &Bridge, params: &Value) -> Value {
    let name = params.get("name").and_then(Value::as_str).unwrap_or("");
    let Some(tool) = tools::find(name) else {
        return tool_error(format!("Tool {name} not found"));
    };
    let args = match tools::validate(tool, params.get("arguments").unwrap_or(&Value::Null)) {
        Ok(args) => args,
        Err(e) => return tool_error(format!("Input validation error: Invalid arguments for tool {name}: {e}")),
    };
    match bridge.call(name, args).await {
        Ok(data) => {
            let text = serde_json::to_string_pretty(&data).unwrap_or_else(|_| "null".into());
            json!({ "content": [{ "type": "text", "text": text }] })
        }
        Err(message) => tool_error(message),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proof_matches_the_typescript_format() {
        // Same inputs as protocol.ts's proofInput; the TS side is tested
        // against this server end to end by mcp-server's `npm run test:relay`.
        assert_eq!(
            bridge::proof_input("server", 8420, "aa", "bb"),
            "openkeep-bridge/v2|server|127.0.0.1:8420|aa|bb"
        );
        assert!(bridge::is_hex32(&json!("0".repeat(64))));
        assert!(!bridge::is_hex32(&json!("A".repeat(64))));
    }

    #[tokio::test]
    async fn answers_initialize_and_unknown_methods() {
        let bridge = Bridge::new(Arc::new(|| None), 29900);
        let init = handle(&bridge, json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-06-18" } }))
            .await
            .unwrap();
        assert_eq!(init["result"]["protocolVersion"], "2025-06-18");
        let unknown = handle(&bridge, json!({ "jsonrpc": "2.0", "id": 2, "method": "resources/list" })).await.unwrap();
        assert_eq!(unknown["error"]["code"], -32601);
        assert!(handle(&bridge, json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })).await.is_none());
        let missing = handle(&bridge, json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": { "name": "nope" } }))
            .await
            .unwrap();
        assert_eq!(missing["result"]["isError"], true);
        let not_connected = handle(&bridge, json!({ "jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": { "name": "list_tags" } }))
            .await
            .unwrap();
        assert!(not_connected["result"]["content"][0]["text"].as_str().unwrap().contains("not connected"));
        assert!(bridge.port().is_none(), "the test never bound a port");
    }
}
