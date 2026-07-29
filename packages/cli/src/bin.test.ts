import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isCliEntry, parseArgs, runCommand } from "./bin.js";
import { writeFixtureTree } from "./test-fixtures.js";

describe("parseArgs", () => {
  it("parses command and --path", () => {
    expect(
      parseArgs(["node", "bin.js", "verify", "--path", "/tmp/nc"]),
    ).toEqual({
      command: "verify",
      path: "/tmp/nc",
    });
    expect(parseArgs(["node", "bin.js"])).toEqual({
      command: "help",
      path: undefined,
    });
  });
});

describe("runCommand", () => {
  it("prints help", () => {
    expect(runCommand(["node", "bin.js", "help"])).toBe(0);
    expect(runCommand(["node", "bin.js", "nope"])).toBe(1);
  });

  it("runs install/verify/uninstall against a fixture", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agenthosts-bin-"));
    try {
      writeFixtureTree(root, fs, path);
      expect(runCommand(["node", "bin.js", "install", "--path", root])).toBe(0);
      expect(runCommand(["node", "bin.js", "verify", "--path", root])).toBe(0);
      expect(runCommand(["node", "bin.js", "sync-skill", "--path", root])).toBe(
        0,
      );
      expect(runCommand(["node", "bin.js", "upgrade", "--path", root])).toBe(0);
      expect(runCommand(["node", "bin.js", "uninstall", "--path", root])).toBe(
        0,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns 1 when verify fails", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agenthosts-bin-bad-"));
    try {
      writeFixtureTree(root, fs, path);
      expect(runCommand(["node", "bin.js", "verify", "--path", root])).toBe(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("isCliEntry", () => {
  it("returns false for mismatched paths", () => {
    expect(isCliEntry(import.meta.url, "/tmp/not-this")).toBe(false);
  });
});
