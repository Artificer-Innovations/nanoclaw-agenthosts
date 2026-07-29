import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getAgenthostsCapabilities,
  probeAgenthostsCapabilities,
  registerRuntimeDriver,
  resetAgenthostsForTests,
  resolveRuntimeDriver,
  resolveRuntimeName,
  resolveSessionTransportName,
  runRuntimeOrphanCleanup,
  setContainerConfigReader,
  setSessionTransportResolver,
  type RuntimeDriver,
  type SessionRef,
} from "./agenthosts.js";
import { resetWarnOnceForTests } from "./warn-once.js";

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

  it("allows matching requiredTransport", () => {
    const fly = stubDriver({ requiredTransport: "http" });
    registerRuntimeDriver("fly", fly);
    setContainerConfigReader(() => ({
      runtime: "fly",
      session_transport: "http",
    }));
    expect(resolveRuntimeDriver(session)).toBe(fly);
  });

  it("unregister removes a driver", () => {
    const docker = stubDriver();
    const unregister = registerRuntimeDriver("docker", docker);
    unregister();
    expect(() => resolveRuntimeDriver(session)).toThrow(/docker/);
  });
});

describe("session transport resolution", () => {
  it("defaults to filesystem", () => {
    expect(resolveSessionTransportName(session)).toBe("filesystem");
  });

  it("prefers sessionio resolver when set", () => {
    setSessionTransportResolver(() => "http");
    setContainerConfigReader(() => ({ session_transport: "filesystem" }));
    expect(resolveSessionTransportName(session)).toBe("http");
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

describe("capabilities", () => {
  it("reports registered runtimes", () => {
    registerRuntimeDriver("docker", stubDriver());
    const caps = getAgenthostsCapabilities();
    expect(caps.apiVersion).toBe(1);
    expect(caps.counts.drivers).toBe(1);
    expect(caps.runtimes).toEqual(["docker"]);
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
    expect(
      probeAgenthostsCapabilities(() => {
        throw new Error("nope");
      }),
    ).toMatchObject({ present: false, reason: "error" });
  });
});
