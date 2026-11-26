// Copyright (c) 2026. Licensed under AGPLv3.
//
// App-side commands behind Settings > AI Assistant Access on desktop: keep
// the pairing token where `--mcp` copies can read it, say how to start one,
// and add one to Claude Desktop's settings.

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{Map, Value, json};

use super::{KEYRING_SERVICE, KEYRING_USER};

/// Name of the entry in an AI tool's list of MCP servers.
const SERVER_NAME: &str = "open-keep";

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| format!("Credential store unavailable: {e}"))
}

/// Called whenever the token changes in the app (minted, regenerated,
/// retired). Empty removes it, so a retired token stops working in every
/// tool set up this way.
#[tauri::command]
pub fn mcp_set_token(token: String) -> Result<(), String> {
    let entry = entry()?;
    if token.is_empty() {
        return match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("Could not remove the pairing token: {e}")),
        };
    }
    if entry.get_password().ok().as_deref() == Some(token.as_str()) {
        return Ok(());
    }
    entry
        .set_password(&token)
        .map_err(|e| format!("Could not save the pairing token to Credential Manager: {e}"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayCommand {
    command: String,
    args: Vec<String>,
}

fn exe_path() -> Result<String, String> {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| format!("Could not find Open Keep's own program file: {e}"))
}

/// How an AI tool starts this app as an MCP server.
#[tauri::command]
pub fn mcp_relay_command() -> Result<RelayCommand, String> {
    Ok(RelayCommand { command: exe_path()?, args: vec!["--mcp".into()] })
}

/// Where Claude Desktop reads its MCP servers from. Its Microsoft Store build
/// keeps its data in %LOCALAPPDATA%\Claude-Data\claude_<package id>; the
/// classic installer in %APPDATA%\Claude.
fn claude_desktop_config() -> Option<PathBuf> {
    const FILE: &str = "claude_desktop_config.json";
    let mut dirs = Vec::new();
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let base = Path::new(&local).join("Claude-Data");
        if let Ok(read) = std::fs::read_dir(&base) {
            let mut found: Vec<PathBuf> = read
                .flatten()
                .filter(|e| e.file_name().to_string_lossy().to_lowercase().starts_with("claude"))
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .collect();
            found.sort();
            dirs.extend(found);
        }
    }
    if let Some(roaming) = std::env::var_os("APPDATA") {
        dirs.push(Path::new(&roaming).join("Claude"));
    }
    // A folder that already has the settings file wins; otherwise the first
    // Claude folder that exists at all.
    dirs.iter()
        .map(|d| d.join(FILE))
        .find(|f| f.is_file())
        .or_else(|| dirs.iter().find(|d| d.is_dir()).map(|d| d.join(FILE)))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeDesktopResult {
    path: String,
    /// False when Open Keep was already there, unchanged.
    changed: bool,
}

/// Adds (or updates) Open Keep in Claude Desktop's list of MCP servers. Other
/// entries and settings are kept as they are, and the file is backed up once.
#[tauri::command]
pub fn mcp_add_to_claude_desktop() -> Result<ClaudeDesktopResult, String> {
    let path = claude_desktop_config().ok_or_else(|| {
        "Couldn't find Claude Desktop on this computer. If it is installed, open it once, then try again.".to_string()
    })?;
    add_server(&path, &exe_path()?)
}

fn add_server(path: &Path, exe: &str) -> Result<ClaudeDesktopResult, String> {
    let shown = path.to_string_lossy().into_owned();
    let existing = match std::fs::read_to_string(path) {
        Ok(text) => Some(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("Couldn't read Claude Desktop's settings ({shown}): {e}")),
    };
    let mut config: Value = match existing.as_deref().map(str::trim) {
        None | Some("") => json!({}),
        Some(text) => serde_json::from_str(text).map_err(|_| {
            format!("Claude Desktop's settings file isn't valid JSON, so Open Keep left it alone: {shown}")
        })?,
    };
    let Some(root) = config.as_object_mut() else {
        return Err(format!("Claude Desktop's settings file has an unexpected layout, so Open Keep left it alone: {shown}"));
    };
    let servers = root.entry("mcpServers").or_insert_with(|| Value::Object(Map::new()));
    let Some(servers) = servers.as_object_mut() else {
        return Err(format!("Claude Desktop's settings file has an unexpected layout, so Open Keep left it alone: {shown}"));
    };
    let wanted = json!({ "command": exe, "args": ["--mcp"] });
    if servers.get(SERVER_NAME) == Some(&wanted) {
        return Ok(ClaudeDesktopResult { path: shown, changed: false });
    }
    servers.insert(SERVER_NAME.into(), wanted);

    let mut text = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    text.push('\n');
    if let Some(original) = existing {
        let backup = path.with_extension("json.openkeep-backup");
        if !backup.exists() {
            std::fs::write(&backup, original).map_err(|e| format!("Couldn't back up Claude Desktop's settings: {e}"))?;
        }
    } else if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    // Write beside it and swap in, so Claude never reads a half-written file.
    let tmp = path.with_extension("json.openkeep-tmp");
    std::fs::write(&tmp, text).map_err(|e| format!("Couldn't write Claude Desktop's settings: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Couldn't write Claude Desktop's settings: {e}")
    })?;
    Ok(ClaudeDesktopResult { path: shown, changed: true })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_config(name: &str, contents: Option<&str>) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("openkeep-claude-config-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("claude_desktop_config.json");
        if let Some(text) = contents {
            std::fs::write(&path, text).unwrap();
        }
        path
    }

    #[test]
    fn the_relay_reads_the_token_the_app_shares() {
        mcp_set_token("token-one".into()).unwrap();
        assert_eq!(super::super::keyring_token().as_deref(), Some("token-one"));
        mcp_set_token("token-two".into()).unwrap();
        assert_eq!(super::super::keyring_token().as_deref(), Some("token-two"));
        mcp_set_token(String::new()).unwrap();
        assert_eq!(super::super::keyring_token(), None);
        mcp_set_token(String::new()).unwrap(); // removing twice is fine
    }

    #[test]
    fn adds_open_keep_and_keeps_everything_else() {
        let path = temp_config(
            "keep",
            Some(r#"{"mcpServers":{"zed":{"command":"z"},"alpha":{"command":"a"}},"preferences":{"x":1}}"#),
        );
        let first = add_server(&path, r"C:\Open Keep\Open Keep.exe").unwrap();
        assert!(first.changed);
        let written: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(written["mcpServers"]["open-keep"]["args"], json!(["--mcp"]));
        assert_eq!(written["mcpServers"]["zed"]["command"], "z");
        assert_eq!(written["preferences"]["x"], 1);
        // Key order is kept (serde_json's preserve_order), so the diff is one entry.
        let keys: Vec<&String> = written["mcpServers"].as_object().unwrap().keys().collect();
        assert_eq!(keys, ["zed", "alpha", "open-keep"]);
        assert!(path.with_extension("json.openkeep-backup").is_file());

        let again = add_server(&path, r"C:\Open Keep\Open Keep.exe").unwrap();
        assert!(!again.changed);
    }

    #[test]
    fn creates_a_missing_file_and_refuses_a_broken_one() {
        let path = temp_config("new", None);
        assert!(add_server(&path, "ok.exe").unwrap().changed);
        assert!(path.is_file());

        let broken = temp_config("broken", Some("{ not json"));
        assert!(add_server(&broken, "ok.exe").is_err());
        assert_eq!(std::fs::read_to_string(&broken).unwrap(), "{ not json");
    }
}
