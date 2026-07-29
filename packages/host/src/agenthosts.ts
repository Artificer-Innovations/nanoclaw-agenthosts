import { warnOnce } from "./warn-once.js";

export const AGENTHOSTS_API_VERSION = 1 as const;
export const DEFAULT_RUNTIME = "docker";

/** Minimal session identity needed to resolve a runtime driver. */
export interface SessionRef {
  id: string;
  agent_group_id: string;
}

export interface WakeContext {
  /** Extensible bag for OneCLI / driver-specific wake helpers. */
  [key: string]: unknown;
}

export interface BuildOpts {
  [key: string]: unknown;
}

export interface RuntimeDriver {
  wake(session: SessionRef, ctx: WakeContext): Promise<boolean>;
  kill(sessionId: string, reason: string, onExit?: () => void): void;
  isRunning(sessionId: string): boolean;
  cleanupOrphans?(): void | Promise<void>;
  buildImage?(agentGroupId: string, opts?: BuildOpts): Promise<void>;
  /** Optional: declare required session transport names (e.g. 'http' for fly). */
  requiredTransport?: string | string[];
}

export interface ContainerConfigSnippet {
  runtime?: string | null;
  session_transport?: string | null;
}

export type ContainerConfigReader = (
  agentGroupId: string,
) => ContainerConfigSnippet | undefined;
export type SessionTransportResolver = (session: SessionRef) => string;

const drivers = new Map<string, RuntimeDriver>();
let containerConfigReader: ContainerConfigReader | null = null;
let sessionTransportResolver: SessionTransportResolver | null = null;

export function setContainerConfigReader(
  reader: ContainerConfigReader | null,
): void {
  containerConfigReader = reader;
}

export function setSessionTransportResolver(
  resolver: SessionTransportResolver | null,
): void {
  sessionTransportResolver = resolver;
}

export function registerRuntimeDriver(
  name: string,
  driver: RuntimeDriver,
): () => void {
  const key = name.trim();
  if (!key) throw new Error("RuntimeDriver name must be non-empty");
  drivers.set(key, driver);
  return () => {
    if (drivers.get(key) === driver) drivers.delete(key);
  };
}

export function listRegisteredRuntimes(): string[] {
  return [...drivers.keys()].sort();
}

export function resolveRuntimeNameFromRow(
  row: ContainerConfigSnippet | undefined,
): string {
  const fromRow = row?.runtime?.trim();
  if (fromRow) return fromRow;
  const fromEnv = process.env.NANOCLAW_DEFAULT_RUNTIME?.trim();
  if (fromEnv) return fromEnv;
  return DEFAULT_RUNTIME;
}

export function resolveSessionTransportNameFromRow(
  session: SessionRef,
  row: ContainerConfigSnippet | undefined,
): string {
  if (sessionTransportResolver) return sessionTransportResolver(session).trim();
  const fromRow = row?.session_transport?.trim();
  if (fromRow) return fromRow;
  return "filesystem";
}

export function resolveRuntimeName(session: SessionRef): string {
  return resolveRuntimeNameFromRow(
    containerConfigReader?.(session.agent_group_id),
  );
}

export function resolveSessionTransportName(session: SessionRef): string {
  return resolveSessionTransportNameFromRow(
    session,
    containerConfigReader?.(session.agent_group_id),
  );
}

function transportMatches(
  actual: string,
  required: string | string[],
): boolean {
  const allowed = Array.isArray(required) ? required : [required];
  return allowed.map((value) => value.trim()).includes(actual.trim());
}

export function resolveRuntimeDriver(session: SessionRef): RuntimeDriver {
  const row = containerConfigReader?.(session.agent_group_id);
  const name = resolveRuntimeNameFromRow(row);
  const driver = drivers.get(name);
  if (!driver) {
    warnOnce(
      `missing-driver:${name}`,
      `No RuntimeDriver registered for runtime="${name}". Install the matching agenthost plugin or set container_configs.runtime.`,
    );
    throw new Error(`No RuntimeDriver registered for runtime="${name}"`);
  }

  if (driver.requiredTransport) {
    const transport = resolveSessionTransportNameFromRow(session, row);
    if (!transportMatches(transport, driver.requiredTransport)) {
      const required = Array.isArray(driver.requiredTransport)
        ? driver.requiredTransport.join("|")
        : driver.requiredTransport;
      warnOnce(
        `transport-mismatch:${name}:${transport}`,
        `Runtime "${name}" requires session transport "${required}" but resolved "${transport}".`,
      );
      throw new Error(
        `Runtime "${name}" requires session transport "${required}" (got "${transport}")`,
      );
    }
  }

  return driver;
}

export async function runRuntimeOrphanCleanup(): Promise<void> {
  for (const [name, driver] of drivers) {
    if (!driver.cleanupOrphans) continue;
    try {
      await driver.cleanupOrphans();
    } catch (error) {
      warnOnce(
        `orphan-cleanup:${name}`,
        `cleanupOrphans failed for runtime="${name}"`,
        error,
      );
    }
  }
}

export function getAgenthostsCapabilities(): {
  apiVersion: typeof AGENTHOSTS_API_VERSION;
  features: { runtimeDrivers: true; orphanCleanup: true; transportGuard: true };
  counts: { drivers: number };
  runtimes: string[];
} {
  return {
    apiVersion: AGENTHOSTS_API_VERSION,
    features: {
      runtimeDrivers: true,
      orphanCleanup: true,
      transportGuard: true,
    },
    counts: { drivers: drivers.size },
    runtimes: listRegisteredRuntimes(),
  };
}

export function probeAgenthostsCapabilities(load: () => unknown):
  | {
      present: true;
      apiVersion: number;
      features: Record<string, boolean>;
      counts: Record<string, number>;
    }
  | { present: false; reason: "absent" | "error"; error?: unknown } {
  try {
    const mod = load() as {
      getAgenthostsCapabilities?: () => {
        apiVersion: number;
        features: Record<string, boolean>;
        counts: Record<string, number>;
      };
    };
    if (!mod || typeof mod.getAgenthostsCapabilities !== "function") {
      return { present: false, reason: "absent" };
    }
    const caps = mod.getAgenthostsCapabilities();
    return {
      present: true,
      apiVersion: caps.apiVersion,
      features: caps.features,
      counts: caps.counts,
    };
  } catch (error) {
    return { present: false, reason: "error", error };
  }
}

export function resetAgenthostsForTests(): void {
  drivers.clear();
  containerConfigReader = null;
  sessionTransportResolver = null;
  delete process.env.NANOCLAW_DEFAULT_RUNTIME;
}

export { warnOnce } from "./warn-once.js";
