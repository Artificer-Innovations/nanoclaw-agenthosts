import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWakeContext,
  emitRuntimeStatus,
  getAgenthostsCapabilities,
  listRegisteredRuntimes,
  probeAgenthostsCapabilities,
  registerRuntimeDriver,
  resetAgenthostsForTests,
  resolveRuntimeDriver,
  resolveRuntimeName,
  resolveSessionTransportName,
  runRuntimeOrphanCleanup,
  setContainerConfigReader,
  setRuntimeActivityImporterForTests,
  setSessionTransportResolver,
  type RuntimeDriver,
  type SessionRef,
} from "./agenthosts.js";
import { migration020 } from "./020-agenthosts-runtime.js";
import { resetWarnOnceForTests, warnOnce } from "./warn-once.js";

function stubDriver(overrides: Partial<RuntimeDriver> = {}): RuntimeDriver {
  return {
    wake: vi.fn(async () => true),
    kill: vi.fn(),
    isRunning: vi.fn(() => false),
    ...overrides,
  };
}

const session: SessionRef = { id: "s1", agent_group_id: "ag-1" };

afterEach(() => {
  resetAgenthostsForTests();
  resetWarnOnceForTests();
});

describe("registerRuntimeDriver / resolveRuntimeDriver", () => {
  it("resolves docker by default when no config is set", () => {
    const docker = stubDriver();
    registerRuntimeDriver("docker", docker);
    expect(resolveRuntimeName(session)).toBe("docker");
    expect(resolveRuntimeDriver(session)).toBe(docker);
  });

  it("rejects empty driver names", () => {
    expect(() => registerRuntimeDriver("  ", stubDriver())).toThrow(
      /non-empty/,
    );
  });

  it("prefers container_configs.runtime over env default", () => {
    process.env.NANOCLAW_DEFAULT_RUNTIME = "docker";
    setContainerConfigReader(() => ({ runtime: "process" }));
    const processDriver = stubDriver();
    registerRuntimeDriver("docker", stubDriver());
    registerRuntimeDriver("process", processDriver);
    expect(resolveRuntimeName(session)).toBe("process");
    expect(resolveRuntimeDriver(session)).toBe(processDriver);
  });

  it("uses NANOCLAW_DEFAULT_RUNTIME when row omits runtime", () => {
    process.env.NANOCLAW_DEFAULT_RUNTIME = "process";
    setContainerConfigReader(() => ({ runtime: null }));
    const processDriver = stubDriver();
    registerRuntimeDriver("process", processDriver);
    expect(resolveRuntimeName(session)).toBe("process");
  });

  it("treats whitespace-only runtime as unset", () => {
    setContainerConfigReader(() => ({ runtime: "   " }));
    registerRuntimeDriver("docker", stubDriver());
    expect(resolveRuntimeName(session)).toBe("docker");
  });

  it("selects per agent group without affecting others", () => {
    const docker = stubDriver();
    const processDriver = stubDriver();
    registerRuntimeDriver("docker", docker);
    registerRuntimeDriver("process", processDriver);
    setContainerConfigReader((id) =>
      id === "ag-process" ? { runtime: "process" } : { runtime: "docker" },
    );
    expect(
      resolveRuntimeDriver({ id: "s-a", agent_group_id: "ag-docker" }),
    ).toBe(docker);
    expect(
      resolveRuntimeDriver({ id: "s-b", agent_group_id: "ag-process" }),
    ).toBe(processDriver);
  });

  it("fails closed when driver is missing", () => {
    setContainerConfigReader(() => ({ runtime: "fly" }));
    expect(() => resolveRuntimeDriver(session)).toThrow(
      /No RuntimeDriver registered for runtime="fly"/,
    );
  });

  it("fails closed on requiredTransport mismatch", () => {
    registerRuntimeDriver("fly", stubDriver({ requiredTransport: "http" }));
    setContainerConfigReader(() => ({
      runtime: "fly",
      session_transport: "filesystem",
    }));
    expect(() => resolveRuntimeDriver(session)).toThrow(
      /requires session transport "http"/,
    );
  });

  it("fails closed when requiredTransport is an array of alternatives", () => {
    registerRuntimeDriver(
      "fly",
      stubDriver({ requiredTransport: ["http", "grpc"] }),
    );
    setContainerConfigReader(() => ({
      runtime: "fly",
      session_transport: "filesystem",
    }));
    expect(() => resolveRuntimeDriver(session)).toThrow(
      /requires session transport "http\|grpc"/,
    );
  });

  it("trims whitespace on both actual and required transports", () => {
    const fly = stubDriver({ requiredTransport: " http " });
    registerRuntimeDriver("fly", fly);
    setSessionTransportResolver(() => "  http  ");
    setContainerConfigReader(() => ({ runtime: "fly" }));
    expect(resolveRuntimeDriver(session)).toBe(fly);
  });

  it("reads container config once when enforcing requiredTransport", () => {
    const reader = vi.fn(() => ({
      runtime: "fly",
      session_transport: "http",
    }));
    registerRuntimeDriver("fly", stubDriver({ requiredTransport: "http" }));
    setContainerConfigReader(reader);
    resolveRuntimeDriver(session);
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it("allows matching requiredTransport string or array", () => {
    const fly = stubDriver({ requiredTransport: ["http", "grpc"] });
    registerRuntimeDriver("fly", fly);
    setContainerConfigReader(() => ({
      runtime: "fly",
      session_transport: "grpc",
    }));
    expect(resolveRuntimeDriver(session)).toBe(fly);
  });

  it("unregister removes only the registered instance", () => {
    const first = stubDriver();
    const second = stubDriver();
    const unregisterFirst = registerRuntimeDriver("docker", first);
    registerRuntimeDriver("docker", second);
    unregisterFirst();
    expect(resolveRuntimeDriver(session)).toBe(second);
    const unregisterSecond = registerRuntimeDriver("docker", second);
    unregisterSecond();
    expect(() => resolveRuntimeDriver(session)).toThrow(/docker/);
  });
});

describe("session transport resolution", () => {
  it("defaults to filesystem", () => {
    expect(resolveSessionTransportName(session)).toBe("filesystem");
  });

  it("reads session_transport from container config when no resolver", () => {
    setContainerConfigReader(() => ({ session_transport: "http" }));
    expect(resolveSessionTransportName(session)).toBe("http");
  });

  it("prefers sessionio resolver when set", () => {
    setSessionTransportResolver(() => "http");
    setContainerConfigReader(() => ({ session_transport: "filesystem" }));
    expect(resolveSessionTransportName(session)).toBe("http");
  });

  it("falls back when resolver returns empty/whitespace", () => {
    setSessionTransportResolver(() => "   ");
    setContainerConfigReader(() => ({ session_transport: "http" }));
    expect(resolveSessionTransportName(session)).toBe("http");

    setSessionTransportResolver(() => "");
    setContainerConfigReader(() => ({ session_transport: null }));
    expect(resolveSessionTransportName(session)).toBe("filesystem");
  });

  it("clears injectable resolvers", () => {
    setContainerConfigReader(() => ({ runtime: "process" }));
    setSessionTransportResolver(() => "http");
    setContainerConfigReader(null);
    setSessionTransportResolver(null);
    registerRuntimeDriver("docker", stubDriver());
    expect(resolveRuntimeName(session)).toBe("docker");
    expect(resolveSessionTransportName(session)).toBe("filesystem");
  });
});

describe("runRuntimeOrphanCleanup", () => {
  it("invokes cleanupOrphans on all drivers that define it", async () => {
    const a = stubDriver({ cleanupOrphans: vi.fn() });
    const b = stubDriver({ cleanupOrphans: vi.fn(async () => undefined) });
    const c = stubDriver();
    registerRuntimeDriver("docker", a);
    registerRuntimeDriver("process", b);
    registerRuntimeDriver("noop", c);
    await runRuntimeOrphanCleanup();
    expect(a.cleanupOrphans).toHaveBeenCalledOnce();
    expect(b.cleanupOrphans).toHaveBeenCalledOnce();
  });

  it("continues when one driver cleanup throws", async () => {
    registerRuntimeDriver(
      "bad",
      stubDriver({
        cleanupOrphans: vi.fn(() => {
          throw new Error("boom");
        }),
      }),
    );
    const good = stubDriver({ cleanupOrphans: vi.fn() });
    registerRuntimeDriver("good", good);
    await runRuntimeOrphanCleanup();
    expect(good.cleanupOrphans).toHaveBeenCalledOnce();
  });
});

describe("createWakeContext / emitRuntimeStatus", () => {
  it("createWakeContext onStatus does not throw without agenttrace", () => {
    const ctx = createWakeContext({
      id: "s1",
      agent_group_id: "ag-1",
      messaging_group_id: "mg-1",
      thread_id: "main",
    });
    expect(() => ctx.onStatus?.("preparing", "Starting agent…")).not.toThrow();
  });

  it("reports runtimeStatus capability", () => {
    const caps = getAgenthostsCapabilities();
    expect(caps.features.runtimeStatus).toBe(true);
  });
});

describe("capabilities", () => {
  it("reports registered runtimes", () => {
    registerRuntimeDriver("docker", stubDriver());
    const caps = getAgenthostsCapabilities();
    expect(caps.apiVersion).toBe(1);
    expect(caps.counts.drivers).toBe(1);
    expect(caps.runtimes).toEqual(["docker"]);
    expect(listRegisteredRuntimes()).toEqual(["docker"]);
  });

  it("probe reports present / absent", () => {
    expect(
      probeAgenthostsCapabilities(() => ({ getAgenthostsCapabilities })),
    ).toMatchObject({
      present: true,
      apiVersion: 1,
    });
    expect(probeAgenthostsCapabilities(() => ({}))).toEqual({
      present: false,
      reason: "absent",
    });
    expect(probeAgenthostsCapabilities(() => null)).toEqual({
      present: false,
      reason: "absent",
    });
    expect(
      probeAgenthostsCapabilities(() => {
        throw new Error("nope");
      }),
    ).toMatchObject({ present: false, reason: "error" });
  });
});

describe("emitRuntimeStatus", () => {
  const activitySession = {
    id: "s1",
    agent_group_id: "ag-1",
    messaging_group_id: "mg-1",
  };

  it("forwards to publishRuntimeActivity when the module is available", async () => {
    const publishRuntimeActivity = vi.fn(async () => undefined);
    setRuntimeActivityImporterForTests(async () => ({
      publishRuntimeActivity,
    }));
    await emitRuntimeStatus(activitySession, "preparing", "Starting…", {
      state: "started",
    });
    expect(publishRuntimeActivity).toHaveBeenCalledWith(activitySession, {
      phase: "preparing",
      summary: "Starting…",
      state: "started",
    });
  });

  it("no-ops when publishRuntimeActivity is missing and when import throws", async () => {
    setRuntimeActivityImporterForTests(async () => ({}));
    await expect(
      emitRuntimeStatus(activitySession, "preparing", "Starting…"),
    ).resolves.toBeUndefined();

    setRuntimeActivityImporterForTests(async () => {
      throw new Error("missing");
    });
    await expect(
      emitRuntimeStatus(activitySession, "preparing", "Starting…"),
    ).resolves.toBeUndefined();
  });

  it("createWakeContext onStatus forwards through emitRuntimeStatus", async () => {
    const publishRuntimeActivity = vi.fn(async () => undefined);
    setRuntimeActivityImporterForTests(async () => ({
      publishRuntimeActivity,
    }));
    const ctx = createWakeContext(activitySession);
    ctx.onStatus?.("ready", "Agent runtime ready…", { state: "succeeded" });
    await vi.waitFor(() => {
      expect(publishRuntimeActivity).toHaveBeenCalled();
    });
  });
});

describe("warnOnce", () => {
  it("emits once per key with and without an error", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    warnOnce("k1", "hello");
    warnOnce("k1", "hello again");
    warnOnce("k2", "with err", new Error("x"));
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe("migration020", () => {
  it("adds runtime and session_transport when absent", () => {
    const statements: string[] = [];
    const db = {
      prepare(sql: string) {
        statements.push(sql);
        return {
          all: () => [{ name: "id" }, { name: "provider" }],
          run: () => undefined,
        };
      },
    };
    migration020.up(db);
    expect(migration020.version).toBe(20);
    expect(migration020.name).toBe("agenthosts-runtime");
    expect(statements).toContain(
      "ALTER TABLE container_configs ADD COLUMN runtime TEXT",
    );
    expect(statements).toContain(
      "ALTER TABLE container_configs ADD COLUMN session_transport TEXT",
    );
  });

  it("is a no-op when columns already exist", () => {
    const alters: string[] = [];
    const db = {
      prepare(sql: string) {
        return {
          all: () => [
            { name: "runtime" },
            { name: "session_transport" },
            { name: "id" },
          ],
          run: () => {
            alters.push(sql);
          },
        };
      },
    };
    migration020.up(db);
    expect(alters).toEqual([]);
  });
});
