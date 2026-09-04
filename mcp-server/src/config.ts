import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".config", "openkeep-mcp");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");
const DEFAULT_PORT = 8420;

export interface Config {
  token: string;
  port: number;
}

/**
 * Resolves the pairing token and port. Precedence: OPENKEEP_MCP_TOKEN env
 * var, then a locally saved config file, then (last resort) a freshly
 * generated token that gets saved and printed to stderr.
 *
 * Open Keep itself is the source of truth for the token: the app mints one
 * in the browser and shows it in Settings > AI Assistant Access. The normal
 * path is that it arrives here as OPENKEEP_MCP_TOKEN, supplied either by the
 * .mcpb extension's user_config field or by hand in an MCP client config.
 * The generate-and-save fallback only exists so running this server bare
 * (e.g. `npm start` while developing) still produces something usable.
 */
export function loadConfig(): Config {
  // This is the BASE of a small port range: the server takes the first free
  // port from it, so several MCP clients can each run their own copy.
  // An .mcpb user_config value the user left blank substitutes as an empty
  // string, and Number("") is 0 — which would silently bind a random port
  // and break the bridge. Anything not a sane port falls back.
  const rawPort = process.env.OPENKEEP_MCP_PORT;
  const parsedPort = rawPort ? Number(rawPort) : Number.NaN;
  const port =
    Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort < 65536
      ? parsedPort
      : DEFAULT_PORT;

  const envToken = process.env.OPENKEEP_MCP_TOKEN?.trim();
  if (envToken) {
    return { token: envToken, port };
  }

  if (existsSync(CONFIG_PATH)) {
    try {
      const stored = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
      if (typeof stored.token === "string" && stored.token.length > 0) {
        return { token: stored.token, port };
      }
    } catch {
      // fall through to regenerate
    }
  }

  const token = randomBytes(24).toString("base64url");
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify({ token }, null, 2) + "\n");

  process.stderr.write(
    [
      "[openkeep-mcp] No pairing token found — generated one and saved it to",
      `[openkeep-mcp]   ${CONFIG_PATH}`,
      "[openkeep-mcp] Enter this exact value into Open Keep > Settings > AI Assistant Access to pair:",
      `[openkeep-mcp]   ${token}`,
      "",
    ].join("\n")
  );

  return { token, port };
}
