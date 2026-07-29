#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("pnpm", ["run", "build"]);

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "agenthosts-int-"));
const writeFixture = await import(
  pathToFileURL(path.join(root, "dist/cli/test-fixtures.js")).href
);
writeFixture.writeFixtureTree(fixture, fs, path);

const bin = path.join(root, "dist/cli/bin.js");
run("node", [bin, "install", "--path", fixture]);
run("node", [bin, "verify", "--path", fixture]);
run("node", [bin, "upgrade", "--path", fixture]);
run("node", [bin, "uninstall", "--path", fixture]);

const runner = fs.readFileSync(
  path.join(fixture, "src/container-runner.ts"),
  "utf8",
);
if (runner.includes("@nanoclaw-agenthosts:")) {
  console.error("Uninstall left agenthosts markers behind");
  process.exit(1);
}
if (fs.existsSync(path.join(fixture, "src/agenthosts.ts"))) {
  console.error("Uninstall left src/agenthosts.ts");
  process.exit(1);
}

fs.rmSync(fixture, { recursive: true, force: true });
console.log("Integration OK");
