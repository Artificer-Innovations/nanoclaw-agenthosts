import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  runInstall,
  runUninstall,
  runUpgrade,
  runVerify,
  syncSkillToFork,
} from "./install.js";
import { findNanoclawRoot, packageRoot } from "./paths.js";
import { writeFixtureTree } from "./test-fixtures.js";
import * as paths from "./paths.js";
import { FILE_TRANSFORMS } from "./patches.js";

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
  vi.restoreAllMocks();
});

describe("paths (fixture)", () => {
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
    // Smoke-bug coverage: optional runtime fields + getSession public exports.
    expect(runner).toContain("getSession");
    expect(fs.readFileSync(path.join(root, "src/types.ts"), "utf8")).toContain(
      "runtime?: string | null",
    );

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

    const delivery = fs.readFileSync(
      path.join(root, "src/delivery.ts"),
      "utf8",
    );
    expect(delivery).not.toContain("@nanoclaw-agenthosts:");
    expect(delivery).not.toContain("markContainerRunning");
  });

  it("preserves warn-once.ts on uninstall when hosthooks is present", () => {
    const root = tempRoot();
    writeFixtureTree(root, fs, path);
    runInstall(root);
    fs.writeFileSync(
      path.join(root, "src/hosthooks.ts"),
      "export const HOSTHOOKS_API_VERSION = 1;\n",
    );
    expect(fs.existsSync(path.join(root, "src/warn-once.ts"))).toBe(true);

    const removed = runUninstall(root);
    expect(removed.removed).toContain("src/agenthosts.ts");
    expect(removed.removed).not.toContain("src/warn-once.ts");
    expect(fs.existsSync(path.join(root, "src/warn-once.ts"))).toBe(true);
    expect(fs.existsSync(path.join(root, "src/agenthosts.ts"))).toBe(false);
  });

  it("removes warn-once.ts on uninstall when hosthooks is absent", () => {
    const root = tempRoot();
    writeFixtureTree(root, fs, path);
    runInstall(root);
    expect(fs.existsSync(path.join(root, "src/hosthooks.ts"))).toBe(false);

    const removed = runUninstall(root);
    expect(removed.removed).toContain("src/warn-once.ts");
    expect(fs.existsSync(path.join(root, "src/warn-once.ts"))).toBe(false);
  });

  it("rolls back when a later transform fails", () => {
    const root = tempRoot();
    writeFixtureTree(root, fs, path);
    fs.writeFileSync(
      path.join(root, "src/cli/resources/groups.ts"),
      "export {};\n",
    );
    expect(() => runInstall(root)).toThrow();
    expect(fs.existsSync(path.join(root, "src/agenthosts.ts"))).toBe(false);
  });

  it("throws when a required host file is missing", () => {
    const root = tempRoot();
    writeFixtureTree(root, fs, path);
    fs.rmSync(path.join(root, "src/index.ts"));
    expect(() => runInstall(root)).toThrow(/Missing required host file/);
  });

  it("reports missing files and invalid transforms during verify", () => {
    const root = tempRoot();
    writeFixtureTree(root, fs, path);
    runInstall(root);
    fs.rmSync(path.join(root, "src/agenthosts.ts"));
    fs.writeFileSync(
      path.join(root, "src/cli/resources/groups.ts"),
      "// @nanoclaw-agenthosts:groups-present-config:begin\nbroken\n",
    );
    const result = runVerify(root);
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.includes("missing"))).toBe(true);
    expect(
      result.issues.some((issue) => issue.includes("invalid agenthosts")),
    ).toBe(true);
  });

  it("verify reports missing transform targets", () => {
    const root = tempRoot();
    writeFixtureTree(root, fs, path);
    fs.rmSync(path.join(root, "src/types.ts"));
    const result = runVerify(root);
    expect(result.ok).toBe(false);
    expect(result.issues).toContain("missing src/types.ts");
  });

  it("uninstall skips missing transform files", () => {
    const root = tempRoot();
    writeFixtureTree(root, fs, path);
    runInstall(root);
    fs.rmSync(path.join(root, "src/index.ts"));
    const result = runUninstall(root);
    expect(result.root).toBe(root);
  });

  it("throws when bundled resource is missing", () => {
    const root = tempRoot();
    writeFixtureTree(root, fs, path);
    const empty = tempRoot();
    fs.mkdirSync(empty, { recursive: true });
    vi.spyOn(paths, "hostResourcesDir").mockReturnValue(empty);
    expect(() => runInstall(root)).toThrow(/Missing bundled resource/);
  });

  it("syncSkillToFork replaces file destinations without wiping user files", () => {
    const root = tempRoot();
    writeFixtureTree(root, fs, path);
    const skillPath = path.join(root, ".claude/skills/add-agenthosts");
    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    fs.writeFileSync(skillPath, "not-a-dir");
    syncSkillToFork(root);
    expect(fs.statSync(skillPath).isDirectory()).toBe(true);
    expect(fs.existsSync(path.join(skillPath, "SKILL.md"))).toBe(true);

    fs.writeFileSync(path.join(skillPath, "stale.txt"), "stale");
    syncSkillToFork(root);
    expect(fs.existsSync(path.join(skillPath, "stale.txt"))).toBe(true);
  });

  it("syncSkillToFork preserves destination symlinks and user files", () => {
    const root = tempRoot();
    writeFixtureTree(root, fs, path);
    const skillLink = path.join(root, ".claude/skills/add-agenthosts");
    fs.mkdirSync(path.dirname(skillLink), { recursive: true });
    const elsewhere = path.join(root, "elsewhere");
    fs.mkdirSync(elsewhere);
    fs.writeFileSync(path.join(elsewhere, "keep.txt"), "keep");
    fs.writeFileSync(path.join(elsewhere, "notes.md"), "mine");
    fs.symlinkSync(elsewhere, skillLink);
    syncSkillToFork(root);
    expect(fs.lstatSync(skillLink).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(path.join(elsewhere, "keep.txt"))).toBe(true);
    expect(fs.existsSync(path.join(elsewhere, "notes.md"))).toBe(true);
    expect(fs.existsSync(path.join(skillLink, "SKILL.md"))).toBe(true);
  });

  it("syncSkillToFork does not wipe user files in an existing skill dir", () => {
    const root = tempRoot();
    writeFixtureTree(root, fs, path);
    syncSkillToFork(root);
    const notes = path.join(root, ".claude/skills/add-agenthosts/notes.md");
    fs.writeFileSync(notes, "keep-me");
    syncSkillToFork(root);
    expect(fs.readFileSync(notes, "utf8")).toBe("keep-me");
    expect(
      fs.existsSync(path.join(root, ".claude/skills/add-agenthosts/SKILL.md")),
    ).toBe(true);
  });

  it("rolls back committed writes when a later atomic write fails", () => {
    const root = tempRoot();
    writeFixtureTree(root, fs, path);
    const original = fs.renameSync;
    let renames = 0;
    const spy = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      renames += 1;
      // Fail after transform files + first new resource (previous === null) committed.
      if (renames === 8) throw new Error("disk-full");
      return original(from, to);
    });
    try {
      expect(() => runInstall(root)).toThrow(/disk-full/);
      expect(fs.existsSync(path.join(root, "src/agenthosts.ts"))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("rollback deletes newly created files (previous === null)", () => {
    const root = tempRoot();
    writeFixtureTree(root, fs, path);
    const original = fs.renameSync;
    let sawNew = false;
    let failed = false;
    const spy = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      const result = original(from, to);
      const dest = String(to);
      if (dest.endsWith("src/agenthosts.ts")) {
        sawNew = true;
        return result;
      }
      if (sawNew && !failed) {
        failed = true;
        throw new Error("fail-after-new-file");
      }
      return result;
    });
    try {
      expect(() => runInstall(root)).toThrow(/fail-after-new-file/);
      expect(fs.existsSync(path.join(root, "src/agenthosts.ts"))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("preserves the original error when rollback also fails", () => {
    const root = tempRoot();
    writeFixtureTree(root, fs, path);
    const originalRename = fs.renameSync;
    let renames = 0;
    const spy = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      renames += 1;
      if (renames === 2) throw new Error("write-boom");
      if (renames > 2) throw new Error("rollback-boom");
      return originalRename(from, to);
    });
    try {
      expect(() => runInstall(root)).toThrow(AggregateError);
    } finally {
      spy.mockRestore();
    }
  });

  it("runInstall/verify/uninstall without --path use cwd NanoClaw root", () => {
    const root = fs.realpathSync(tempRoot());
    writeFixtureTree(root, fs, path);
    const cwd = process.cwd();
    process.chdir(root);
    try {
      expect(fs.realpathSync(runInstall().root)).toBe(root);
      expect(runVerify().ok).toBe(true);
      fs.unlinkSync(path.join(root, "src/index.ts"));
      const removed = runUninstall();
      expect(fs.realpathSync(removed.root)).toBe(root);
    } finally {
      process.chdir(cwd);
    }
  });

  it("verify catch stringifies non-Error throws from transforms", () => {
    const root = tempRoot();
    writeFixtureTree(root, fs, path);
    const target = FILE_TRANSFORMS.find((f) => f.path === "src/index.ts")!;
    const original = target.transform;
    target.transform = () => {
      throw "index-boom";
    };
    try {
      const verify = runVerify(root);
      expect(verify.ok).toBe(false);
      expect(verify.issues.some((i) => i.includes("index-boom"))).toBe(true);
    } finally {
      target.transform = original;
    }
  });
});
