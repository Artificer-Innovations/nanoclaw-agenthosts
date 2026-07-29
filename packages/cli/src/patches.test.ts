import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  patchContainerConfigsDb,
  patchContainerRunner,
  patchGroupsCli,
  patchIndex,
  patchMigrationsIndex,
  patchTypes,
  unpatchContainerConfigsDb,
  unpatchContainerRunner,
  unpatchGroupsCli,
  unpatchIndex,
  unpatchMigrationsIndex,
  unpatchTypes,
} from "./patches.js";
import { fixtureSources } from "./test-fixtures.js";

describe("patchContainerRunner", () => {
  it("is idempotent and preserves hosthooks markers", () => {
    const once = patchContainerRunner(fixtureSources.containerRunner);
    expect(once).toContain("@nanoclaw-agenthosts:container-import:begin");
    expect(once).toContain("@nanoclaw-hosthooks:container-import:begin");
    expect(once).toContain("function wakeContainerDocker");
    expect(once).toContain("registerRuntimeDriver");
    expect(once).toContain("export function wakeContainer");
    expect(patchContainerRunner(once)).toBe(once);
  });

  it("uninstall restores stock exports", () => {
    const patched = patchContainerRunner(fixtureSources.containerRunner);
    const restored = unpatchContainerRunner(patched);
    expect(restored).toContain(
      "export function wakeContainer(session: Session)",
    );
    expect(restored).not.toContain("@nanoclaw-agenthosts:");
    expect(restored).toContain("@nanoclaw-hosthooks:container-import:begin");
  });
});

describe("patchIndex", () => {
  it("replaces orphan cleanup and uninstalls cleanly", () => {
    const patched = patchIndex(fixtureSources.index);
    expect(patched).toContain("await runRuntimeOrphanCleanup()");
    expect(patchIndex(patched)).toBe(patched);
    const restored = unpatchIndex(patched);
    expect(restored).toContain("cleanupOrphans();");
    expect(restored).not.toContain("@nanoclaw-agenthosts:");
  });
});

describe("patchTypes / db / migrations / groups", () => {
  it("adds runtime fields and restores on uninstall", () => {
    const patched = patchTypes(fixtureSources.types);
    expect(patched).toContain("runtime?: string | null");
    expect(patched).toContain("session_transport?: string | null");
    expect(unpatchTypes(patched)).toContain(
      "cli_scope: string; // 'disabled' | 'group' | 'global'\n  updated_at: string;",
    );
  });

  it("extends SCALAR_COLUMNS", () => {
    const patched = patchContainerConfigsDb(fixtureSources.containerConfigs);
    expect(patched).toContain("'runtime'");
    expect(patched).toContain("'session_transport'");
    const restored = unpatchContainerConfigsDb(patched);
    expect(restored).toContain("'cli_scope',\n]);");
    expect(restored).not.toContain("'runtime'");
  });

  it("registers migration020", () => {
    const patched = patchMigrationsIndex(fixtureSources.migrationsIndex);
    expect(patched).toContain("from './020-agenthosts-runtime.js'");
    expect(patched).toContain("migration020");
    expect(unpatchMigrationsIndex(patched)).not.toContain("migration020");
  });

  it("adds ncl --runtime wiring", () => {
    const patched = patchGroupsCli(fixtureSources.groups);
    expect(patched).toContain("runtime: row.runtime");
    expect(patched).toContain("args.runtime");
    expect(patched).toContain("--session-transport");
    expect(patchGroupsCli(patched)).toBe(patched);
    const restored = unpatchGroupsCli(patched);
    expect(restored).toContain(
      "initGroupFilesystem(group);\n        return getAgentGroupByFolder(folder);",
    );
  });
});

describe("partial markers", () => {
  it("throws on partial container-runner markers", () => {
    const partial =
      fixtureSources.containerRunner +
      "\n// @nanoclaw-agenthosts:container-import:begin\nimport { resolveRuntimeDriver } from './agenthosts.js';\n// @nanoclaw-agenthosts:container-import:end\n";
    expect(() => patchContainerRunner(partial)).toThrow(
      /Partial agenthosts markers/,
    );
  });
});
