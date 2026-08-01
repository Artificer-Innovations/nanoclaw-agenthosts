import { warnOnce } from "./warn-once.js";

export const AGENTHOSTS_API_VERSION = 1 as const;
export const DEFAULT_RUNTIME = "docker";

/** Minimal session identity needed to resolve a runtime driver. */
export interface SessionRef {
  id: string;
  agent_group_id: string;
}

/**
 * Optional host/runtime status callback (agenttrace `publishRuntimeActivity`).
 * `phase` stays a plain string — agenttrace is an optional peer, so we avoid a
 * hard type dependency on its `RuntimeActivityPhase` union.
 */
export type RuntimeStatusFn = (
  phase: string,
  summary: string,
  extra?: { state?: "started" | "progress" | "succeeded" | "failed" },
) => void;

export interface WakeContext {
  /** Emit vendor-neutral runtime lifecycle status (preparing, starting, …). */
  onStatus?: RuntimeStatusFn;
  /** Extensible bag for OneCLI / driver-specific wake helpers. */
  [key: string]: unknown;
}

/** Session fields needed to route runtime status to a messaging channel. */
export interface RuntimeActivitySession {
  id: string;
  agent_group_id: string;
  messaging_group_id?: string | null;
  thread_id?: string | null;
}

/** Delay before coarse wake bookends emit — warm already-running hits stay quiet. */
export const COARSE_WAKE_STATUS_MS = 250;

/** Bound fire-and-forget publish so a hung agenttrace dispatch cannot pile up. */
export const RUNTIME_STATUS_TIMEOUT_MS = 2_000;

type RuntimeActivityModule = {
  publishRuntimeActivity?: (
    session: RuntimeActivitySession,
    input: {
      phase: string;
      summary: string;
      state?: "started" | "progress" | "succeeded" | "failed";
    },
  ) => Promise<void>;
};

let runtimeActivityImporter: (() => Promise<RuntimeActivityModule>) | null =
  null;

/** Test seam — inject a fake agenttrace lifecycle module. */
export function setRuntimeActivityImporterForTests(
  importer: (() => Promise<RuntimeActivityModule>) | null,
): void {
  runtimeActivityImporter = importer;
}

async function loadRuntimeActivityModule(): Promise<RuntimeActivityModule> {
  if (runtimeActivityImporter) return runtimeActivityImporter();
  // Non-literal import — agenttrace-lifecycle.js only exists after agenttrace
  // install into a NanoClaw host; keep this optional without string codegen.
  const modulePath = "./agenttrace-lifecycle.js";
  return import(modulePath) as Promise<RuntimeActivityModule>;
}

/**
 * Fire-and-forget runtime status via optional agenttrace.
 * No-ops when agenttrace is not installed or disabled.
 * Returns a promise for tests; production callers ignore it.
 */
export function emitRuntimeStatus(
  session: RuntimeActivitySession,
  phase: string,
  summary: string,
  extra?: { state?: "started" | "progress" | "succeeded" | "failed" },
): Promise<void> {
  return (async () => {
    try {
      const mod = await loadRuntimeActivityModule();
      if (typeof mod.publishRuntimeActivity !== "function") return;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          mod
            .publishRuntimeActivity(session, {
              phase,
              summary,
              state: extra?.state,
            })
            .finally(() => {
              if (timeoutId !== undefined) clearTimeout(timeoutId);
            }),
          new Promise<never>((_, reject) => {
            timeoutId = setTimeout(
              () => reject(new Error("runtime status publish timed out")),
              RUNTIME_STATUS_TIMEOUT_MS,
            );
            timeoutId.unref?.();
          }),
        ]);
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
      }
    } catch {
      // agenttrace not installed, timed out, or dispatch failed
    }
  })();
}

/** Build a WakeContext whose onStatus forwards to emitRuntimeStatus. */
export function createWakeContext(
  session: RuntimeActivitySession,
): WakeContext {
  return {
    onStatus(phase, summary, extra) {
      emitRuntimeStatus(session, phase, summary, extra);
    },
  };
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
  if (sessionTransportResolver) {
    const fromResolver = sessionTransportResolver(session).trim();
    if (fromResolver) return fromResolver;
  }
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
  features: {
    runtimeDrivers: true;
    orphanCleanup: true;
    transportGuard: true;
    runtimeStatus: true;
  };
  counts: { drivers: number };
  runtimes: string[];
} {
  return {
    apiVersion: AGENTHOSTS_API_VERSION,
    features: {
      runtimeDrivers: true,
      orphanCleanup: true,
      transportGuard: true,
      runtimeStatus: true,
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
  runtimeActivityImporter = null;
  delete process.env.NANOCLAW_DEFAULT_RUNTIME;
}

export { warnOnce } from "./warn-once.js";
