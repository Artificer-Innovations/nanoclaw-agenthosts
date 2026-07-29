import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  runInstall,
  runUninstall,
  runUpgrade,
  runVerify,
  syncSkillToFork,
} from "./install.js";
import { findNanoclawRoot, packageRoot } from "./paths.js";
import { writeFixtureTree } from "./test-fixtures.js";

const temps: string[] = [];

function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agenthosts-"));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("paths", () => {
  it("finds package root and nanoclaw fixture root", () => {
    expect(packageRoot()).toContain("nanoclaw-agenthosts");
    const root = tempRoot();
    writeFixtureTree(root, fs, path);
    expect(findNanoclawRoot(root)).toBe(root);
  });
});

describe("install / verify / uninstall", () => {
  it("installs, verifies, upgrades idempotently, and uninstalls", () => {
    const root = tempRoot();
    writeFixtureTree(root, fs, path);

    const installed = runInstall(root);
    expect(installed.changed.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(root, "src/agenthosts.ts"))).toBe(true);
    expect(
      fs.existsSync(
        path.join(root, "src/db/migrations/020-agenthosts-runtime.ts"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(root, ".claude/skills/add-agenthosts/SKILL.md")),
    ).toBe(true);

    const verify = runVerify(root);
    expect(verify.ok).toBe(true);

    const upgraded = runUpgrade(root);
    expect(upgraded.unchanged.length).toBeGreaterThan(0);

    const runner = fs.readFileSync(
      path.join(root, "src/container-runner.ts"),
      "utf8",
    );
    expect(runner).toContain("@nanoclaw-hosthooks:container-import:begin");
    expect(runner).toContain("registerRuntimeDriver");

    const removed = runUninstall(root);
    expect(removed.removed).toContain("src/agenthosts.ts");
    expect(fs.existsSync(path.join(root, "src/agenthosts.ts"))).toBe(false);
    expect(
      fs.existsSync(path.join(root, ".claude/skills/add-agenthosts")),
    ).toBe(false);

    const stockRunner = fs.readFileSync(
      path.join(root, "src/container-runner.ts"),
      "utf8",
    );
    expect(stockRunner).toContain("export function wakeContainer");
    expect(stockRunner).not.toContain("@nanoclaw-agenthosts:");
  });

  it("rolls back when a later transform fails", () => {
    const root = tempRoot();
    writeFixtureTree(root, fs, path);
    // Break groups.ts create anchor so patchGroupsCli fails after earlier files staged.
    fs.writeFileSync(
      path.join(root, "src/cli/resources/groups.ts"),
      "export {};\n",
    );
    expect(() => runInstall(root)).toThrow();
    expect(fs.existsSync(path.join(root, "src/agenthosts.ts"))).toBe(false);
  });

  it("syncSkillToFork replaces symlink destinations safely", () => {
    const root = tempRoot();
    writeFixtureTree(root, fs, path);
    const skillLink = path.join(root, ".claude/skills/add-agenthosts");
    fs.mkdirSync(path.dirname(skillLink), { recursive: true });
    const elsewhere = path.join(root, "elsewhere");
    fs.mkdirSync(elsewhere);
    fs.writeFileSync(path.join(elsewhere, "keep.txt"), "keep");
    fs.symlinkSync(elsewhere, skillLink);
    syncSkillToFork(root);
    expect(fs.lstatSync(skillLink).isSymbolicLink()).toBe(false);
    expect(fs.existsSync(path.join(elsewhere, "keep.txt"))).toBe(true);
    expect(fs.existsSync(path.join(skillLink, "SKILL.md"))).toBe(true);
  });
});
