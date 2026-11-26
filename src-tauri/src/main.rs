// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  // An AI tool starting the app as its MCP server: no window, no single-instance
  // handover (that would focus the running app and exit), just stdio.
  if open_keep_lib::mcp_requested() {
    std::process::exit(open_keep_lib::run_mcp());
  }
  open_keep_lib::run();
}
