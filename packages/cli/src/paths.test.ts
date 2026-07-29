import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  findNanoclawRoot,
  hostResourcesDir,
  packageRoot,
  readPackageVersion,
  skillDir,
} from "./paths.js";

describe("paths", () => {
  it("locates resources", () => {
    expect(packageRoot()).toMatch(/nanoclaw-agenthosts$/);
    expect(skillDir()).toContain("add-agenthosts");
    expect(hostResourcesDir()).toContain("host");
    expect(readPackageVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("falls back to skill resources when packages/host/src is absent", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "agenthosts-paths-"));
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "nanoclaw-agenthosts", version: "0.0.0" }),
    );
    fs.mkdirSync(path.join(root, "skills/add-agenthosts/resources/host"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(root, "packages/cli/src"), { recursive: true });
    const start = path.join(root, "packages/cli/src");
    expect(hostResourcesDir(start)).toBe(
      path.join(root, "skills/add-agenthosts/resources/host"),
    );
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("throws when package root cannot be located", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "not-agenthosts-pkg-"));
    expect(() => packageRoot(dir)).toThrow(
      /Could not locate nanoclaw-agenthosts package root/,
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("throws when NanoClaw root missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "not-nanoclaw-"));
    expect(() => findNanoclawRoot(dir)).toThrow(/NanoClaw root not found/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("skips malformed package.json while walking for package root", () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "agenthosts-malformed-"),
    );
    const nested = path.join(root, "a", "b");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, "package.json"), "{not-json");
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "nanoclaw-agenthosts", version: "9.9.9" }),
    );
    expect(packageRoot(nested)).toBe(root);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
