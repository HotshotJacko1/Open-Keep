// Builds the distributable .mcpb bundle.
//
// Packs a staging copy rather than this folder directly, so the bundle gets
// production dependencies only (no typescript, no @types) and none of the
// source or test files. Output lands in build/.
//
//   npm run pack:mcpb
//
// Portable across Windows/macOS/Linux - the bundle is pure JS, so one built
// anywhere installs anywhere.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stage = join(root, "build", "stage");
const outDir = join(root, "build");

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });

console.log("> compiling");
run("npm", ["run", "build"], root);

console.log("> staging");
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const entry of ["dist", "manifest.json", "icon.png", "package.json", "package-lock.json", "README.md"]) {
  cpSync(join(root, entry), join(stage, entry), { recursive: true });
}

console.log("> installing production dependencies");
run("npm", ["ci", "--omit=dev"], stage);

console.log("> packing");
// Call the local @anthropic-ai/mcpb CLI through node rather than `npx mcpb`:
// on Windows npx misses the local bin when .bin has no .cmd shim and falls
// back to the (nonexistent) `mcpb` registry package, and going through the
// shell would split paths containing spaces.
const mcpbCli = join(root, "node_modules", "@anthropic-ai", "mcpb", "dist", "cli", "cli.js");
execFileSync(process.execPath, [mcpbCli, "pack", stage, join(outDir, "open-keep.mcpb")], { cwd: root, stdio: "inherit" });

console.log(`\nDone: ${join(outDir, "open-keep.mcpb")}`);
console.log("Attach this file to a GitHub release; users download and double-click it.");
