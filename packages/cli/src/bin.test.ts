import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isCliEntry, main, parseArgs, runCommand } from "./bin.js";
import * as install from "./install.js";
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

  it("returns 1 when install throws", () => {
    expect(
      runCommand([
        "node",
        "bin",
        "install",
        "--path",
        "/tmp/does-not-exist-agenthosts",
      ]),
    ).toBe(1);
  });

  it("sync-skill without --path uses findNanoclawRoot from cwd", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agenthosts-cwd-"));
    writeFixtureTree(root, fs, path);
    const cwd = process.cwd();
    process.chdir(root);
    try {
      expect(runCommand(["node", "bin", "sync-skill"])).toBe(0);
    } finally {
      process.chdir(cwd);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("stringifies non-Error throws", () => {
    const spy = vi.spyOn(install, "runInstall").mockImplementation(() => {
      throw "plain-string-failure";
    });
    expect(runCommand(["node", "bin", "install", "--path", "/tmp/x"])).toBe(1);
    spy.mockRestore();
  });

  it("isCliEntry matches same path and catch fallback", () => {
    const self = fileURLToPath(import.meta.url);
    expect(isCliEntry(self, ["node", self])).toBe(true);
    expect(isCliEntry(self, ["node"])).toBe(false);
    expect(isCliEntry(self, ["node", `${self}-nope`])).toBe(false);
    expect(isCliEntry("/no/such/cli", ["node", "/no/such/cli"])).toBe(true);
    expect(isCliEntry("/no/such/cli", ["node", "/other"])).toBe(false);
  });

  it("main exits via runCommand", () => {
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    const argv = process.argv;
    process.argv = ["node", "bin", "help"];
    main();
    expect(exitSpy).toHaveBeenCalledWith(0);
    process.argv = argv;
    exitSpy.mockRestore();
  });
});
