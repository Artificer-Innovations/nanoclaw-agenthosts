import { describe, expect, it } from "vitest";
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

const BEGIN = (name: string) => `// @nanoclaw-agenthosts:${name}:begin`;
const END = (name: string) => `// @nanoclaw-agenthosts:${name}:end`;

describe("patchContainerRunner", () => {
  it("is idempotent and preserves hosthooks markers", () => {
    const once = patchContainerRunner(fixtureSources.containerRunner);
    expect(once).toContain("@nanoclaw-agenthosts:container-import:begin");
    expect(once).toContain("@nanoclaw-hosthooks:container-import:begin");
    expect(once).toContain("function wakeContainerDocker");
    expect(once).toContain("registerRuntimeDriver");
    expect(once).toContain("export async function wakeContainer");
    expect(once).toContain("getSession");
    expect(once).toContain("setSessionTransportResolver");
    expect(once).toContain("createRequire");
    expect(patchContainerRunner(once)).toBe(once);
  });

  it("widens an older agenthosts import on upgrade when refreshing public-exports", () => {
    const installed = patchContainerRunner(fixtureSources.containerRunner);
    // Simulate a prior install that omitted resolveRuntimeName / setSessionTransportResolver
    // (upgrade used to refresh public-exports without widening the import → tsc fail).
    const staleImport = installed.replace(
      "import { registerRuntimeDriver, resolveRuntimeDriver, resolveRuntimeName, setContainerConfigReader, setSessionTransportResolver } from './agenthosts.js';",
      "import { registerRuntimeDriver, resolveRuntimeDriver, setContainerConfigReader } from './agenthosts.js';",
    );
    expect(staleImport).toContain(
      "import { registerRuntimeDriver, resolveRuntimeDriver, setContainerConfigReader } from './agenthosts.js';",
    );
    expect(staleImport).not.toMatch(
      /import \{[^}]*\bresolveRuntimeName\b[^}]*\} from '\.\/agenthosts\.js'/,
    );
    const upgraded = patchContainerRunner(staleImport);
    expect(upgraded).toMatch(
      /import \{[^}]*\bresolveRuntimeName\b[^}]*\bsetSessionTransportResolver\b[^}]*\} from '\.\/agenthosts\.js'/,
    );
    expect(upgraded).toContain("const runtime = resolveRuntimeName(session);");
    expect(patchContainerRunner(upgraded)).toBe(upgraded);
  });

  it("keeps unknown agenthosts import symbols when widening on upgrade", () => {
    const installed = patchContainerRunner(fixtureSources.containerRunner);
    const withExtra = installed.replace(
      "import { registerRuntimeDriver, resolveRuntimeDriver, resolveRuntimeName, setContainerConfigReader, setSessionTransportResolver } from './agenthosts.js';",
      "import { registerRuntimeDriver, resolveRuntimeDriver, setContainerConfigReader, someFutureHelper } from './agenthosts.js';",
    );
    const upgraded = patchContainerRunner(withExtra);
    expect(upgraded).toMatch(
      /import \{ registerRuntimeDriver, resolveRuntimeDriver, resolveRuntimeName, setContainerConfigReader, setSessionTransportResolver, someFutureHelper \} from '\.\/agenthosts\.js';/,
    );
  });

  it("still refreshes public-exports when the agenthosts import line is missing", () => {
    const installed = patchContainerRunner(fixtureSources.containerRunner);
    const withoutImport = installed.replace(
      /import \{[^}]+\} from '\.\/agenthosts\.js';\r?\n/,
      "",
    );
    const upgraded = patchContainerRunner(withoutImport);
    expect(upgraded).toContain("const runtime = resolveRuntimeName(session);");
    expect(upgraded).not.toMatch(/import \{[^}]+\} from '\.\/agenthosts\.js';/);
  });

  it("keeps sessions-import as a sibling of container-import (not nested)", () => {
    const patched = patchContainerRunner(fixtureSources.containerRunner);
    const containerEnd = patched.indexOf(END("container-import"));
    const sessionsBegin = patched.indexOf(BEGIN("sessions-import"));
    const sessionsEnd = patched.indexOf(END("sessions-import"));
    expect(containerEnd).toBeGreaterThan(-1);
    expect(sessionsBegin).toBeGreaterThan(containerEnd);
    expect(sessionsEnd).toBeGreaterThan(sessionsBegin);
    const restored = unpatchContainerRunner(patched);
    expect(restored).not.toContain("@nanoclaw-agenthosts:");
    expect(restored).not.toContain("getSession");
  });

  it("only falls back to docker when runtime resolves to docker", () => {
    const patched = patchContainerRunner(fixtureSources.containerRunner);
    expect(patched).toContain("if (runtime === 'docker')");
    expect(patched).toContain(
      "return await resolveRuntimeDriver(session).wake",
    );
    expect(patched).not.toContain(
      "return resolveRuntimeDriver(session).wake(session, {});",
    );
  });

  it("refreshes public-exports on already-installed trees (upgrade path)", () => {
    const installed = patchContainerRunner(fixtureSources.containerRunner);
    const stale = installed.replace(
      "falling back to docker map",
      "OLD_FALLBACK_TEXT",
    );
    const refreshed = patchContainerRunner(stale);
    expect(refreshed).toContain("falling back to docker map");
    expect(refreshed).not.toContain("OLD_FALLBACK_TEXT");
  });

  it("handles CRLF line endings when refreshing public-exports", () => {
    const installed = patchContainerRunner(fixtureSources.containerRunner);
    const crlf = installed.replaceAll("\n", "\r\n");
    const refreshed = patchContainerRunner(crlf);
    expect(refreshed).toContain("resolveRuntimeDriver(session)");
  });

  it("refreshes public-exports when end marker has no trailing newline", () => {
    const installed = patchContainerRunner(fixtureSources.containerRunner);
    const endMarker = END("public-exports");
    const endIdx = installed.indexOf(endMarker);
    const withoutTrailing = `${installed.slice(0, endIdx + endMarker.length)}TAIL`;
    const refreshed = patchContainerRunner(withoutTrailing);
    expect(refreshed).toContain("resolveRuntimeDriver(session)");
    expect(refreshed).toContain("TAIL");
  });

  it("accepts trees that already import cleanupOrphans", () => {
    const source = fixtureSources.containerRunner.replace(
      "import { CONTAINER_RUNTIME_BIN, hostGatewayArgs, readonlyMountArgs, stopContainer } from './container-runtime.js';",
      "import { CONTAINER_RUNTIME_BIN, cleanupOrphans, hostGatewayArgs, readonlyMountArgs, stopContainer } from './container-runtime.js';",
    );
    const patched = patchContainerRunner(source);
    expect(patched).toContain("cleanupOrphans");
    expect(patched).toContain("registerRuntimeDriver('docker'");
  });

  it("throws when container-runtime import cannot gain cleanupOrphans", () => {
    const source = fixtureSources.containerRunner.replace(
      "import { CONTAINER_RUNTIME_BIN, hostGatewayArgs, readonlyMountArgs, stopContainer } from './container-runtime.js';",
      "import { CONTAINER_RUNTIME_BIN } from './other.js';",
    );
    expect(() => patchContainerRunner(source)).toThrow(
      /Could not find container-runtime import/,
    );
  });

  it("does not treat a bare cleanupOrphans mention as a wired import", () => {
    const source = fixtureSources.containerRunner.replace(
      "import { CONTAINER_RUNTIME_BIN, hostGatewayArgs, readonlyMountArgs, stopContainer } from './container-runtime.js';",
      "import { CONTAINER_RUNTIME_BIN } from './other.js';\n// cleanupOrphans mentioned in a comment",
    );
    expect(() => patchContainerRunner(source)).toThrow(
      /Could not find container-runtime import/,
    );
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

  it("throws on unbalanced braces for rename targets", () => {
    const broken = fixtureSources.containerRunner.replace(
      `export function killContainer(sessionId: string, reason: string, onExit?: () => void): void {
  const entry = activeContainers.get(sessionId);
  if (!entry) return;
  if (onExit) entry.process.once('close', onExit);
  try {
    stopContainer(entry.containerName);
  } catch {
    entry.process.kill('SIGKILL');
  }
}`,
      `export function killContainer(sessionId: string, reason: string, onExit?: () => void): void {
  const entry = activeContainers.get(sessionId);
`,
    );
    expect(() => patchContainerRunner(broken)).toThrow(/Unbalanced braces/);
  });
});

describe("patchIndex", () => {
  it("replaces orphan cleanup and uninstalls cleanly", () => {
    const patched = patchIndex(fixtureSources.index);
    expect(patched).toContain("await runRuntimeOrphanCleanup()");
    expect(patched).not.toMatch(
      /import \{[^}]*\bcleanupOrphans\b[^}]*\} from '\.\/container-runtime\.js'/,
    );
    expect(patchIndex(patched)).toBe(patched);
    const restored = unpatchIndex(patched);
    expect(restored).toContain("cleanupOrphans();");
    expect(restored).toMatch(
      /import \{[^}]*\bcleanupOrphans\b[^}]*\} from '\.\/container-runtime\.js'/,
    );
    expect(restored).not.toContain("@nanoclaw-agenthosts:");
  });

  it("restores cleanupOrphans when stock call is missing after uninstall", () => {
    const source = `import { ensureContainerRuntimeRunning } from './container-runtime.js';

async function main(): Promise<void> {
  ensureContainerRuntimeRunning();
  log.info('ready');
}
`;
    const restored = unpatchIndex(source);
    expect(restored).toContain("cleanupOrphans();");
    expect(restored).toMatch(
      /import \{[^}]*\bcleanupOrphans\b[^}]*\} from '\.\/container-runtime\.js'/,
    );
  });

  it("leaves import unchanged when cleanupOrphans was never present", () => {
    const source = `import { ensureContainerRuntimeRunning } from './container-runtime.js';

async function main(): Promise<void> {
  cleanupOrphans();
}
`;
    const patched = patchIndex(source);
    expect(patched).toContain("await runRuntimeOrphanCleanup()");
    expect(patched).toContain(
      "import { ensureContainerRuntimeRunning } from './container-runtime.js';",
    );
  });

  it("drops the container-runtime import when it only imported cleanupOrphans", () => {
    const source = `import { cleanupOrphans } from './container-runtime.js';

async function main(): Promise<void> {
  cleanupOrphans();
}
`;
    const patched = patchIndex(source);
    expect(patched).toContain("await runRuntimeOrphanCleanup()");
    expect(patched).not.toContain("from './container-runtime.js'");
    expect(patched).not.toMatch(/import \{\s*\} from/);
  });

  it("round-trips when the dropped import must be synthesized on uninstall", () => {
    const source = `import { cleanupOrphans } from './container-runtime.js';

async function main(): Promise<void> {
  ensureContainerRuntimeRunning();
  cleanupOrphans();
}
`;
    const patched = patchIndex(source);
    expect(patched).not.toContain("from './container-runtime.js'");
    const restored = unpatchIndex(patched);
    expect(restored).toContain("cleanupOrphans();");
    expect(restored).toContain(
      "import { cleanupOrphans } from './container-runtime.js';",
    );
    expect(restored).not.toContain("@nanoclaw-agenthosts:");
  });

  it("synthesizes cleanupOrphans import ahead of remaining imports on uninstall", () => {
    const source = `import { log } from './log.js';
import { cleanupOrphans } from './container-runtime.js';

async function main(): Promise<void> {
  ensureContainerRuntimeRunning();
  cleanupOrphans();
}
`;
    const restored = unpatchIndex(patchIndex(source));
    expect(restored.indexOf("import { cleanupOrphans }")).toBeLessThan(
      restored.indexOf("import { log }"),
    );
    expect(restored).toContain("cleanupOrphans();");
  });

  it("keeps existing cleanupOrphans import on uninstall when already present", () => {
    const patched = `import { ensureContainerRuntimeRunning, cleanupOrphans } from './container-runtime.js';
// @nanoclaw-agenthosts:index-import:begin
import { runRuntimeOrphanCleanup } from './agenthosts.js';
// @nanoclaw-agenthosts:index-import:end
async function main(): Promise<void> {
  ensureContainerRuntimeRunning();
// @nanoclaw-agenthosts:index-orphan-cleanup:begin
  await runRuntimeOrphanCleanup();
// @nanoclaw-agenthosts:index-orphan-cleanup:end
}
`;
    const restored = unpatchIndex(patched);
    expect(restored).toContain("cleanupOrphans();");
    expect(restored).toContain(
      "import { ensureContainerRuntimeRunning, cleanupOrphans } from './container-runtime.js';",
    );
  });

  it("appends cleanupOrphans when container-runtime import lacks ensureContainerRuntimeRunning", () => {
    const source = `import { stopContainer } from './container-runtime.js';

async function main(): Promise<void> {
  ensureContainerRuntimeRunning();
}
`;
    const restored = unpatchIndex(source);
    expect(restored).toContain("cleanupOrphans();");
    expect(restored).toContain(
      "import { stopContainer, cleanupOrphans } from './container-runtime.js';",
    );
  });
});

describe("patchTypes / db / migrations / groups", () => {
  it("adds optional runtime fields (smoke-bug: required fields break backfill)", () => {
    const patched = patchTypes(fixtureSources.types);
    expect(patched).toContain("runtime?: string | null");
    expect(patched).toContain("session_transport?: string | null");
    expect(unpatchTypes(patched)).toContain(
      "cli_scope: string; // 'disabled' | 'group' | 'global'\n  updated_at: string;",
    );
  });

  it("upgrades older required runtime fields to optional", () => {
    const required = fixtureSources.types.replace(
      "  cli_scope: string; // 'disabled' | 'group' | 'global'\n  updated_at: string;\n}",
      `${BEGIN("types-runtime-fields")}
  cli_scope: string; // 'disabled' | 'group' | 'global'
  /** Agenthosts runtime driver name (docker | process | fly | …). Null = instance default. */
  runtime: string | null;
  /** Optional session transport (filesystem | http). Null = filesystem / sessionio default. */
  session_transport: string | null;
  updated_at: string;
}
${END("types-runtime-fields")}`,
    );
    const upgraded = patchTypes(required);
    expect(upgraded).toContain("runtime?: string | null");
    expect(upgraded).toContain("session_transport?: string | null");
    expect(unpatchTypes(required)).toContain(
      "cli_scope: string; // 'disabled' | 'group' | 'global'\n  updated_at: string;",
    );
  });

  it("unpatchTypes falls back to removeMarkedBlock for unknown bodies", () => {
    const odd = `${BEGIN("types-runtime-fields")}\n  runtime: 'weird';\n${END("types-runtime-fields")}\n`;
    expect(unpatchTypes(odd)).toBe("");
    expect(unpatchTypes("no markers")).toBe("no markers");
  });

  it("extends SCALAR_COLUMNS", () => {
    const patched = patchContainerConfigsDb(fixtureSources.containerConfigs);
    expect(patched).toContain("'runtime'");
    expect(patched).toContain("'session_transport'");
    expect(patchContainerConfigsDb(patched)).toBe(patched);
    const restored = unpatchContainerConfigsDb(patched);
    expect(restored).toContain("'cli_scope',\n]);");
    expect(restored).not.toContain("'runtime'");
  });

  it("registers migration020", () => {
    const patched = patchMigrationsIndex(fixtureSources.migrationsIndex);
    expect(patched).toContain("from './020-agenthosts-runtime.js'");
    expect(patched).toContain("migration020");
    expect(patchMigrationsIndex(patched)).toBe(patched);
    expect(unpatchMigrationsIndex(patched)).not.toContain("migration020");
  });

  it("adds ncl --runtime wiring", () => {
    const patched = patchGroupsCli(fixtureSources.groups);
    expect(patched).toContain("runtime: row.runtime");
    expect(patched).toContain("args.runtime");
    expect(patched).toContain("--session-transport");
    expect(patched).toContain("listRegisteredRuntimes");
    expect(patched).toContain(
      "--runtime must be one of the registered runtimes",
    );
    expect(patchGroupsCli(patched)).toBe(patched);
    const restored = unpatchGroupsCli(patched);
    expect(restored).toContain(
      "initGroupFilesystem(group);\n        return getAgentGroupByFolder(folder);",
    );
    expect(restored).not.toContain("listRegisteredRuntimes");
  });
});

describe("partial markers and anchors", () => {
  it("throws on partial container-runner markers", () => {
    const partial =
      fixtureSources.containerRunner +
      `\n${BEGIN("container-import")}\nimport { resolveRuntimeDriver } from './agenthosts.js';\n${END("container-import")}\n`;
    expect(() => patchContainerRunner(partial)).toThrow(
      /Partial agenthosts markers/,
    );
  });

  it("throws when afterMarker is missing for a sibling import", () => {
    const patched = patchContainerRunner(fixtureSources.containerRunner);
    const withoutSiblings = patched
      .replace(
        new RegExp(
          `${BEGIN("create-require-import")}[\\s\\S]*?${END("create-require-import")}\\r?\\n?`,
        ),
        "",
      )
      .replace(
        new RegExp(
          `${BEGIN("sessions-import")}[\\s\\S]*?${END("sessions-import")}\\r?\\n?`,
        ),
        "",
      )
      .replace(`${END("container-import")}\n`, "");
    expect(() => patchContainerRunner(withoutSiblings)).toThrow(
      /Could not find container-import end marker/,
    );
  });

  it("inserts sibling imports after CRLF end markers", () => {
    const installed = patchContainerRunner(fixtureSources.containerRunner);
    const withoutSiblings = installed
      .replace(
        new RegExp(
          `${BEGIN("create-require-import")}[\\s\\S]*?${END("create-require-import")}\\r?\\n?`,
        ),
        "",
      )
      .replace(
        new RegExp(
          `${BEGIN("sessions-import")}[\\s\\S]*?${END("sessions-import")}\\r?\\n?`,
        ),
        "",
      );
    const crlf = withoutSiblings.replaceAll("\n", "\r\n");
    const patched = patchContainerRunner(crlf);
    const containerEnd = patched.indexOf(END("container-import"));
    const sessionsBegin = patched.indexOf(BEGIN("sessions-import"));
    expect(sessionsBegin).toBeGreaterThan(containerEnd);
  });

  it("throws when import anchors are missing", () => {
    expect(() =>
      patchIndex("export function main() { cleanupOrphans(); }\n"),
    ).toThrow(/Could not find import anchor/);
  });

  it("throws when anchors are missing", () => {
    expect(() => patchTypes("export interface ContainerConfigRow {}")).toThrow(
      /Could not find ContainerConfigRow fields/,
    );
  });
});
