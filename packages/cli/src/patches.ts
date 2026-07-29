export const AGENTHOSTS_MARKER = "@nanoclaw-agenthosts";

const begin = (name: string): string => `// ${AGENTHOSTS_MARKER}:${name}:begin`;
const end = (name: string): string => `// ${AGENTHOSTS_MARKER}:${name}:end`;

export interface FileTransform {
  path: string;
  transform: (content: string) => string;
  uninstall: (content: string) => string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceOnce(
  content: string,
  search: string,
  replacement: string,
  label: string,
): string {
  const first = content.indexOf(search);
  if (first < 0) throw new Error(`Could not find ${label} anchor`);
  /* v8 ignore next 3 */
  if (content.indexOf(search, first + search.length) >= 0) {
    throw new Error(`${label} anchor is ambiguous`);
  }
  return (
    content.slice(0, first) + replacement + content.slice(first + search.length)
  );
}

function installImport(
  content: string,
  modulePath: string,
  symbols: string[],
  name: string,
  options: { afterMarker?: string } = {},
): string {
  if (content.includes(begin(name))) return content;
  const block = `${begin(name)}\nimport { ${symbols.join(", ")} } from '${modulePath}';\n${end(name)}\n`;
  if (options.afterMarker) {
    const anchor = end(options.afterMarker);
    const idx = content.indexOf(anchor);
    if (idx < 0) {
      throw new Error(
        `Could not find ${options.afterMarker} end marker for ${name}`,
      );
    }
    let insertAt = idx + anchor.length;
    if (content[insertAt] === "\r") insertAt += 1;
    if (content[insertAt] === "\n") insertAt += 1;
    return content.slice(0, insertAt) + block + content.slice(insertAt);
  }
  const firstImport = content.search(/^import /m);
  if (firstImport < 0)
    throw new Error(`Could not find import anchor for ${name}`);
  return content.slice(0, firstImport) + block + content.slice(firstImport);
}

function removeMarkedBlock(content: string, name: string): string {
  const pattern = new RegExp(
    `^[ \\t]*${escapeRegExp(begin(name))}\\r?\\n[\\s\\S]*?^[ \\t]*${escapeRegExp(end(name))}\\r?\\n?`,
    "m",
  );
  const next = content.replace(pattern, "");
  /* v8 ignore next 3 */
  if (content.includes(begin(name)) && next === content) {
    throw new Error(`Corrupt agenthosts block: ${name}`);
  }
  return next;
}

function marked(name: string, body: string): string {
  return `${begin(name)}\n${body}\n${end(name)}`;
}

function isFullyPatched(source: string, names: string[]): boolean {
  const present = names.filter((name) => source.includes(begin(name)));
  if (present.length === 0) return false;
  if (present.length !== names.length) {
    throw new Error(
      `Partial agenthosts markers: found [${present.join(", ")}] expected [${names.join(", ")}]`,
    );
  }
  return true;
}

function endOfFunction(content: string, signature: string): number {
  const pos = content.indexOf(signature);
  /* v8 ignore next */
  if (pos < 0) throw new Error(`Could not find function ${signature}`);
  const openBrace = content.indexOf("{", pos);
  let depth = 0;
  for (let i = openBrace; i < content.length; i += 1) {
    const ch = content[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  throw new Error(`Unbalanced braces for ${signature}`);
}

const STOCK_RUNTIME_IMPORT =
  "import { CONTAINER_RUNTIME_BIN, hostGatewayArgs, readonlyMountArgs, stopContainer } from './container-runtime.js';";
const PATCHED_RUNTIME_IMPORT =
  "import { CONTAINER_RUNTIME_BIN, cleanupOrphans, hostGatewayArgs, readonlyMountArgs, stopContainer } from './container-runtime.js';";

const CONTAINER_IMPORT_SYMBOLS = [
  "registerRuntimeDriver",
  "resolveRuntimeDriver",
  "resolveRuntimeName",
  "setContainerConfigReader",
  "setSessionTransportResolver",
] as const;

/**
 * Widen `./agenthosts.js` import to the current symbol set on upgrade.
 * Older installs omit resolveRuntimeName / setSessionTransportResolver while
 * refreshPublicExports already emits bodies that call resolveRuntimeName.
 *
 * Scoped to the `@nanoclaw-agenthosts:container-import` marker block so we
 * never rewrite a user-owned import of the same module path.
 */
function widenAgenthostsImport(source: string): string {
  const startMark = begin("container-import");
  const endMark = end("container-import");
  const start = source.indexOf(startMark);
  const endIdx = source.indexOf(endMark);
  if (start < 0 || endIdx < 0 || endIdx < start) return source;

  const blockStart = start;
  const blockEnd = endIdx + endMark.length;
  const block = source.slice(blockStart, blockEnd);
  const re = /import\s*\{([^}]*)\}\s*from\s*['"]\.\/agenthosts\.js['"]/;
  const match = block.match(re);
  if (!match) return source;

  const current = match[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const missing = CONTAINER_IMPORT_SYMBOLS.filter(
    (symbol) => !current.includes(symbol),
  );
  if (missing.length === 0) return source;
  const extras = current.filter(
    (symbol) =>
      !(CONTAINER_IMPORT_SYMBOLS as readonly string[]).includes(symbol),
  );
  const ordered = [...CONTAINER_IMPORT_SYMBOLS, ...extras];
  const nextBlock = block.replace(
    re,
    `import { ${ordered.join(", ")} } from './agenthosts.js';`,
  );
  return source.slice(0, blockStart) + nextBlock + source.slice(blockEnd);
}

export function patchContainerRunner(source: string): string {
  const coreNames = [
    "container-import",
    "is-running-rename",
    "wake-rename",
    "kill-rename",
    "docker-register",
    "public-exports",
  ];

  // Already installed (v1): ensure sibling imports + refresh public-exports body.
  if (coreNames.every((name) => source.includes(begin(name)))) {
    let content = widenAgenthostsImport(source);
    content = installImport(
      content,
      "./db/sessions.js",
      ["getSession"],
      "sessions-import",
      { afterMarker: "container-import" },
    );
    content = installImport(
      content,
      "node:module",
      ["createRequire"],
      "create-require-import",
      { afterMarker: "sessions-import" },
    );
    return refreshPublicExports(content);
  }

  if (coreNames.some((name) => source.includes(begin(name)))) {
    throw new Error(
      `Partial agenthosts markers: found [${coreNames.filter((n) => source.includes(begin(n))).join(", ")}] expected [${coreNames.join(", ")}]`,
    );
  }

  let content = installImport(
    source,
    "./agenthosts.js",
    [...CONTAINER_IMPORT_SYMBOLS],
    "container-import",
  );

  // Insert as a sibling after container-import:end — never nest inside that block.
  content = installImport(
    content,
    "./db/sessions.js",
    ["getSession"],
    "sessions-import",
    { afterMarker: "container-import" },
  );

  content = installImport(
    content,
    "node:module",
    ["createRequire"],
    "create-require-import",
    { afterMarker: "sessions-import" },
  );

  if (content.includes(STOCK_RUNTIME_IMPORT)) {
    content = replaceOnce(
      content,
      STOCK_RUNTIME_IMPORT,
      PATCHED_RUNTIME_IMPORT,
      "cleanupOrphans import",
    );
  } else if (!content.includes(PATCHED_RUNTIME_IMPORT)) {
    throw new Error(
      "Could not find container-runtime import to add cleanupOrphans",
    );
  }

  // Comment-only rename markers so uninstall does not delete the signature line.
  content = replaceOnce(
    content,
    "export function isContainerRunning(sessionId: string): boolean {",
    `${marked("is-running-rename", "// isContainerRunning → isContainerRunningDocker")}\nfunction isContainerRunningDocker(sessionId: string): boolean {`,
    "isContainerRunning export",
  );

  content = replaceOnce(
    content,
    "export function wakeContainer(session: Session): Promise<boolean> {",
    `${marked("wake-rename", "// wakeContainer → wakeContainerDocker")}\nfunction wakeContainerDocker(session: Session): Promise<boolean> {`,
    "wakeContainer export",
  );

  content = replaceOnce(
    content,
    "export function killContainer(sessionId: string, reason: string, onExit?: () => void): void {",
    `${marked("kill-rename", "// killContainer → killContainerDocker")}\nfunction killContainerDocker(sessionId: string, reason: string, onExit?: () => void): void {`,
    "killContainer export",
  );

  const killSig =
    "function killContainerDocker(sessionId: string, reason: string, onExit?: () => void): void {";
  const insertAt = endOfFunction(content, killSig);

  const registerBlock = marked(
    "docker-register",
    `setContainerConfigReader((agentGroupId) => {
  const row = getContainerConfig(agentGroupId);
  if (!row) return undefined;
  return {
    runtime: (row as { runtime?: string | null }).runtime ?? null,
    session_transport: (row as { session_transport?: string | null }).session_transport ?? null,
  };
});

// Optional companion: live transport name from nanoclaw-sessionio for requiredTransport checks.
try {
  const require = createRequire(import.meta.url);
  const sessionio = require('./sessionio.js') as {
    resolveTransportName?: (session: { id: string; agent_group_id: string }) => string;
  };
  if (typeof sessionio.resolveTransportName === 'function') {
    setSessionTransportResolver((session) => sessionio.resolveTransportName!(session));
  }
} catch {
  // sessionio not installed in this host tree — fall back to DB / filesystem default
}

registerRuntimeDriver('docker', {
  wake: (session) => wakeContainerDocker(session as Session),
  kill: killContainerDocker,
  isRunning: isContainerRunningDocker,
  cleanupOrphans,
});`,
  );

  const exportsBlock = marked("public-exports", publicExportsBody());

  content =
    content.slice(0, insertAt) +
    "\n\n" +
    registerBlock +
    "\n\n" +
    exportsBlock +
    "\n" +
    content.slice(insertAt);

  return content;
}

/** Empty slot owned by agenthosts; sessionio replaces it with wake-prepare-meta. */
const SESSIONIO_WAKE_PREPARE_SLOT =
  "    // @nanoclaw-sessionio:wake-prepare-meta-slot";

/**
 * Keep sessionio's filled wake-prepare-meta (or the empty slot) when refreshing
 * public-exports. Without this, every agenthosts upgrade/verify wipes the fill
 * and verify fails with "missing agenthosts call sites" after sessionio install.
 */
function extractWakePrepareFragment(source: string): string {
  const regionStart = source.indexOf(begin("public-exports"));
  const regionEndMarker = end("public-exports");
  const regionEnd = source.indexOf(regionEndMarker);
  const region =
    regionStart >= 0 && regionEnd > regionStart
      ? source.slice(regionStart, regionEnd)
      : source;

  const filled = region.match(
    /^[ \t]*\/\/ @nanoclaw-sessionio:wake-prepare-meta:begin\r?\n[\s\S]*?^[ \t]*\/\/ @nanoclaw-sessionio:wake-prepare-meta:end(?=\r?\n)/m,
  );
  if (filled) return filled[0];

  const slot = region.match(
    /^[ \t]*\/\/ @nanoclaw-sessionio:wake-prepare-meta-slot(?=\r?\n)/m,
  );
  if (slot) return slot[0];

  return SESSIONIO_WAKE_PREPARE_SLOT;
}

function publicExportsBody(
  wakePrepareFragment: string = SESSIONIO_WAKE_PREPARE_SLOT,
): string {
  const body = `export function isContainerRunning(sessionId: string): boolean {
  const session = getSession(sessionId);
  if (!session) return isContainerRunningDocker(sessionId);
  const runtime = resolveRuntimeName(session);
  try {
    return resolveRuntimeDriver(session).isRunning(sessionId);
  } catch (err) {
    if (runtime === 'docker') {
      log.debug('isContainerRunning docker driver resolve failed — falling back to docker map', {
        sessionId,
        err,
      });
      return isContainerRunningDocker(sessionId);
    }
    throw err;
  }
}

export async function wakeContainer(session: Session): Promise<boolean> {
  const runtime = resolveRuntimeName(session);
  try {
    // Project destinations/routing before ANY runtime wake (docker, process, …).
    // spawnContainer (docker) already does the same projection; calling it here too
    // is intentional and idempotent (replaceDestinations + routing upsert) so
    // process/other drivers cannot skip it and wake with an empty destinations map.
    //
    // Ambient free identifiers — already present in stock container-runner.ts:
    //   hasTable/getDb  → import from './db/connection.js' (spawnContainer's
    //                     writeDestinations gate uses the identical call)
    //   writeSessionRouting → import from './session-manager.js' (sessionio's
    //                     container-runner-meta patch also anchors on this call)
    // Do not installImport them: a second binding would duplicate stock imports and break tsc.
    if (hasTable(getDb(), 'agent_destinations')) {
      const { writeDestinations } = await import('./modules/agent-to-agent/write-destinations.js');
      writeDestinations(session.agent_group_id, session.id);
    }
    writeSessionRouting(session.agent_group_id, session.id);
    // @nanoclaw-sessionio:wake-prepare-meta-slot
    return await resolveRuntimeDriver(session).wake(session, {});
  } catch (err) {
    if (runtime === 'docker') {
      log.warn('wakeContainer failed — host-sweep will retry', { sessionId: session.id, err });
      return false;
    }
    throw err;
  }
}

export function killContainer(sessionId: string, reason: string, onExit?: () => void): void {
  const session = getSession(sessionId);
  if (!session) {
    killContainerDocker(sessionId, reason, onExit);
    return;
  }
  const runtime = resolveRuntimeName(session);
  try {
    resolveRuntimeDriver(session).kill(sessionId, reason, onExit);
  } catch (err) {
    if (runtime === 'docker') {
      log.warn('killContainer docker driver resolve failed — falling back to docker kill', {
        sessionId,
        err,
      });
      killContainerDocker(sessionId, reason, onExit);
      return;
    }
    throw err;
  }
}`;
  // Filled sessionio blocks may use different marker indentation; substitute whole.
  if (wakePrepareFragment === SESSIONIO_WAKE_PREPARE_SLOT) return body;
  return body.replace(SESSIONIO_WAKE_PREPARE_SLOT, wakePrepareFragment);
}

function refreshPublicExports(source: string): string {
  const start = source.indexOf(begin("public-exports"));
  const endMarker = end("public-exports");
  const endIdx = source.indexOf(endMarker);
  /* v8 ignore next 3 */
  if (start < 0 || endIdx < 0) {
    throw new Error("public-exports markers missing during refresh");
  }
  const afterEnd = endIdx + endMarker.length;
  const trailingNewline =
    source[afterEnd] === "\r" || source[afterEnd] === "\n" ? 1 : 0;
  const trailingCr =
    source[afterEnd] === "\r" && source[afterEnd + 1] === "\n" ? 1 : 0;
  const cut = afterEnd + trailingNewline + trailingCr;
  return (
    source.slice(0, start) +
    marked(
      "public-exports",
      publicExportsBody(extractWakePrepareFragment(source)),
    ) +
    "\n" +
    source.slice(cut)
  );
}

export function unpatchContainerRunner(source: string): string {
  let content = source;
  for (const name of [
    "public-exports",
    "docker-register",
    "kill-rename",
    "wake-rename",
    "is-running-rename",
    "create-require-import",
    "sessions-import",
    "container-import",
  ]) {
    content = removeMarkedBlock(content, name);
  }

  content = content.replace(
    "function isContainerRunningDocker(sessionId: string): boolean {",
    "export function isContainerRunning(sessionId: string): boolean {",
  );
  content = content.replace(
    "function wakeContainerDocker(session: Session): Promise<boolean> {",
    "export function wakeContainer(session: Session): Promise<boolean> {",
  );
  content = content.replace(
    "function killContainerDocker(sessionId: string, reason: string, onExit?: () => void): void {",
    "export function killContainer(sessionId: string, reason: string, onExit?: () => void): void {",
  );

  if (content.includes(PATCHED_RUNTIME_IMPORT)) {
    content = content.replace(PATCHED_RUNTIME_IMPORT, STOCK_RUNTIME_IMPORT);
  }

  return content;
}

export function patchIndex(source: string): string {
  const names = ["index-import", "index-orphan-cleanup"];
  if (isFullyPatched(source, names)) return source;

  let content = installImport(
    source,
    "./agenthosts.js",
    ["runRuntimeOrphanCleanup"],
    "index-import",
  );

  content = replaceOnce(
    content,
    "  cleanupOrphans();",
    marked("index-orphan-cleanup", "  await runRuntimeOrphanCleanup();"),
    "index cleanupOrphans call",
  );

  // Drop unused cleanupOrphans from the stock container-runtime import so hosts
  // that lint unused imports still build after install.
  content = content.replace(
    /import \{([^}]+)\} from '\.\/container-runtime\.js';/,
    (match, symbols: string) => {
      const parts = symbols
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const next = parts.filter((s) => s !== "cleanupOrphans");
      if (next.length === parts.length) return match;
      if (next.length === 0) {
        // Only cleanupOrphans was imported — drop the whole statement.
        return "";
      }
      return `import { ${next.join(", ")} } from './container-runtime.js';`;
    },
  );

  return content;
}

export function unpatchIndex(source: string): string {
  let content = removeMarkedBlock(source, "index-orphan-cleanup");
  content = removeMarkedBlock(content, "index-import");
  if (
    !content.includes("cleanupOrphans();") &&
    content.includes("ensureContainerRuntimeRunning();")
  ) {
    content = replaceOnce(
      content,
      "  ensureContainerRuntimeRunning();\n",
      "  ensureContainerRuntimeRunning();\n  cleanupOrphans();\n",
      "restore cleanupOrphans",
    );
  }
  // Restore cleanupOrphans on the container-runtime import when the call is back.
  // patchIndex may have dropped the whole import when cleanupOrphans was its only
  // symbol — synthesize a fresh import in that case so uninstall is runnable.
  if (content.includes("cleanupOrphans();")) {
    const importRe = /import \{([^}]+)\} from '\.\/container-runtime\.js';/;
    if (importRe.test(content)) {
      content = content.replace(importRe, (match, symbols: string) => {
        const parts = symbols
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (parts.includes("cleanupOrphans")) return match;
        const ensureIdx = parts.indexOf("ensureContainerRuntimeRunning");
        if (ensureIdx >= 0) parts.splice(ensureIdx + 1, 0, "cleanupOrphans");
        else parts.push("cleanupOrphans");
        return `import { ${parts.join(", ")} } from './container-runtime.js';`;
      });
    } else {
      const stmt = `import { cleanupOrphans } from './container-runtime.js';\n`;
      const firstImport = content.search(/^import /m);
      content =
        firstImport >= 0
          ? content.slice(0, firstImport) + stmt + content.slice(firstImport)
          : stmt + content;
    }
  }
  return content;
}

export function patchTypes(source: string): string {
  if (source.includes(begin("types-runtime-fields"))) {
    // Upgrade older installs that used required fields.
    return source
      .replace(
        "  /** Agenthosts runtime driver name (docker | process | fly | …). Null = instance default. */\n  runtime: string | null;",
        "  /** Agenthosts runtime driver name (docker | process | fly | …). Null/absent = instance default. */\n  runtime?: string | null;",
      )
      .replace(
        "  /** Optional session transport (filesystem | http). Null = filesystem / sessionio default. */\n  session_transport: string | null;",
        "  /** Optional session transport (filesystem | http). Null/absent = filesystem / sessionio default. */\n  session_transport?: string | null;",
      );
  }

  return replaceOnce(
    source,
    "  cli_scope: string; // 'disabled' | 'group' | 'global'\n  updated_at: string;\n}",
    marked(
      "types-runtime-fields",
      `  cli_scope: string; // 'disabled' | 'group' | 'global'
  /** Agenthosts runtime driver name (docker | process | fly | …). Null/absent = instance default. */
  runtime?: string | null;
  /** Optional session transport (filesystem | http). Null/absent = filesystem / sessionio default. */
  session_transport?: string | null;
  updated_at: string;
}`,
    ),
    "ContainerConfigRow fields",
  );
}

export function unpatchTypes(source: string): string {
  if (!source.includes(begin("types-runtime-fields"))) return source;
  // Accept both required and optional forms when restoring stock.
  const optionalForm = marked(
    "types-runtime-fields",
    `  cli_scope: string; // 'disabled' | 'group' | 'global'
  /** Agenthosts runtime driver name (docker | process | fly | …). Null/absent = instance default. */
  runtime?: string | null;
  /** Optional session transport (filesystem | http). Null/absent = filesystem / sessionio default. */
  session_transport?: string | null;
  updated_at: string;
}`,
  );
  const requiredForm = marked(
    "types-runtime-fields",
    `  cli_scope: string; // 'disabled' | 'group' | 'global'
  /** Agenthosts runtime driver name (docker | process | fly | …). Null = instance default. */
  runtime: string | null;
  /** Optional session transport (filesystem | http). Null = filesystem / sessionio default. */
  session_transport: string | null;
  updated_at: string;
}`,
  );
  const stock =
    "  cli_scope: string; // 'disabled' | 'group' | 'global'\n  updated_at: string;\n}";
  if (source.includes(optionalForm)) {
    return replaceOnce(
      source,
      optionalForm,
      stock,
      "restore ContainerConfigRow fields",
    );
  }
  if (source.includes(requiredForm)) {
    return replaceOnce(
      source,
      requiredForm,
      stock,
      "restore ContainerConfigRow fields",
    );
  }
  return removeMarkedBlock(source, "types-runtime-fields");
}

const STOCK_SCALAR_COLUMNS = `const SCALAR_COLUMNS = new Set([
  'provider',
  'model',
  'effort',
  'image_tag',
  'assistant_name',
  'max_messages_per_prompt',
  'cli_scope',
]);`;

const PATCHED_SCALAR_COLUMNS = `const SCALAR_COLUMNS = new Set([
  'provider',
  'model',
  'effort',
  'image_tag',
  'assistant_name',
  'max_messages_per_prompt',
  'cli_scope',
  'runtime',
  'session_transport',
]);`;

const STOCK_SCALARS_PICK =
  "'provider' | 'model' | 'effort' | 'image_tag' | 'assistant_name' | 'max_messages_per_prompt' | 'cli_scope'";
const PATCHED_SCALARS_PICK =
  "'provider' | 'model' | 'effort' | 'image_tag' | 'assistant_name' | 'max_messages_per_prompt' | 'cli_scope' | 'runtime' | 'session_transport'";

export function patchContainerConfigsDb(source: string): string {
  const names = ["db-scalar-columns", "db-update-scalars-type"];
  if (isFullyPatched(source, names)) return source;

  let content = replaceOnce(
    source,
    STOCK_SCALAR_COLUMNS,
    marked("db-scalar-columns", PATCHED_SCALAR_COLUMNS),
    "SCALAR_COLUMNS",
  );

  content = replaceOnce(
    content,
    STOCK_SCALARS_PICK,
    marked("db-update-scalars-type", PATCHED_SCALARS_PICK),
    "updateContainerConfigScalars Pick type",
  );

  return content;
}

export function unpatchContainerConfigsDb(source: string): string {
  let content = source;
  if (content.includes(begin("db-update-scalars-type"))) {
    content = replaceOnce(
      content,
      marked("db-update-scalars-type", PATCHED_SCALARS_PICK),
      STOCK_SCALARS_PICK,
      "restore scalars pick",
    );
  }
  if (content.includes(begin("db-scalar-columns"))) {
    content = replaceOnce(
      content,
      marked("db-scalar-columns", PATCHED_SCALAR_COLUMNS),
      STOCK_SCALAR_COLUMNS,
      "restore SCALAR_COLUMNS",
    );
  }
  return content;
}

export function patchMigrationsIndex(source: string): string {
  const names = ["migrations-import", "migrations-register"];
  if (isFullyPatched(source, names)) return source;

  let content = source;

  // Coupled to upstream tip migration019: bump these anchors when NanoClaw adds
  // migration020+ before this package's migration020 is still the next number.
  if (!content.includes(begin("migrations-import"))) {
    content = replaceOnce(
      content,
      "import { migration019 } from './019-wiring-threads.js';",
      `import { migration019 } from './019-wiring-threads.js';
${begin("migrations-import")}
import { migration020 } from './020-agenthosts-runtime.js';
${end("migrations-import")}`,
      "migration019 import",
    );
  }

  if (!content.includes(begin("migrations-register"))) {
    content = replaceOnce(
      content,
      "  migration019,\n];",
      `  migration019,
${begin("migrations-register")}
  migration020,
${end("migrations-register")}
];`,
      "migration019 register",
    );
  }

  return content;
}

export function unpatchMigrationsIndex(source: string): string {
  let content = removeMarkedBlock(source, "migrations-register");
  content = removeMarkedBlock(content, "migrations-import");
  return content;
}

export function patchGroupsCli(source: string): string {
  const names = [
    "groups-agenthosts-import",
    "groups-present-config",
    "groups-create-runtime",
    "groups-config-update-desc",
    "groups-config-update-type",
    "groups-config-update-fields",
  ];
  if (isFullyPatched(source, names)) return source;

  let content = installImport(
    source,
    "../../agenthosts.js",
    ["listRegisteredRuntimes"],
    "groups-agenthosts-import",
  );

  content = replaceOnce(
    content,
    `    cli_scope: row.cli_scope,
    updated_at: row.updated_at,
  };
}`,
    marked(
      "groups-present-config",
      `    cli_scope: row.cli_scope,
    runtime: row.runtime,
    session_transport: row.session_transport,
    updated_at: row.updated_at,
  };
}`,
    ),
    "presentConfig return",
  );

  content = replaceOnce(
    content,
    `        initGroupFilesystem(group);
        return getAgentGroupByFolder(folder);
      },
    },
    delete: {`,
    marked(
      "groups-create-runtime",
      `        initGroupFilesystem(group);
        if (args.runtime !== undefined || args['session-transport'] !== undefined || args.session_transport !== undefined) {
          const stamped: Partial<Pick<ContainerConfigRow, 'runtime' | 'session_transport'>> = {};
          if (args.runtime !== undefined) {
            const runtime = String(args.runtime);
            const known = listRegisteredRuntimes();
            if (known.length > 0 && !known.includes(runtime)) {
              throw new Error(
                \`--runtime must be one of the registered runtimes: \${known.join(', ')} (got "\${runtime}")\`,
              );
            }
            stamped.runtime = runtime;
          }
          const transport = args['session-transport'] ?? args.session_transport;
          if (transport !== undefined) stamped.session_transport = String(transport);
          updateContainerConfigScalars(id, stamped);
        }
        return getAgentGroupByFolder(folder);
      },
    },
    delete: {`,
    ),
    "groups create initGroupFilesystem",
  );

  content = replaceOnce(
    content,
    `'Update container config scalar fields. Changes are saved but do NOT take effect until you run \`ncl groups restart\`. ' +
        'Use --id <group-id> and any of: --provider, --model, --effort, --image-tag, --assistant-name, --max-messages-per-prompt, --cli-scope.',`,
    marked(
      "groups-config-update-desc",
      `'Update container config scalar fields. Changes are saved but do NOT take effect until you run \`ncl groups restart\`. ' +
        'Use --id <group-id> and any of: --provider, --model, --effort, --image-tag, --assistant-name, --max-messages-per-prompt, --cli-scope, --runtime, --session-transport.',`,
    ),
    "config update description",
  );

  content = replaceOnce(
    content,
    STOCK_SCALARS_PICK,
    marked("groups-config-update-type", PATCHED_SCALARS_PICK),
    "groups config update Pick type",
  );

  content = replaceOnce(
    content,
    `        if (args['cli-scope'] !== undefined || args.cli_scope !== undefined) {
          const scope = (args['cli-scope'] ?? args.cli_scope) as string;
          if (!['disabled', 'group', 'global'].includes(scope)) {
            throw new Error('--cli-scope must be one of: disabled, group, global');
          }
          updates.cli_scope = scope;
        }

        if (Object.keys(updates).length === 0) {
          throw new Error(
            'Nothing to update — provide at least one of: --provider, --model, --effort, --image-tag, --assistant-name, --max-messages-per-prompt, --cli-scope',
          );
        }`,
    marked(
      "groups-config-update-fields",
      `        if (args['cli-scope'] !== undefined || args.cli_scope !== undefined) {
          const scope = (args['cli-scope'] ?? args.cli_scope) as string;
          if (!['disabled', 'group', 'global'].includes(scope)) {
            throw new Error('--cli-scope must be one of: disabled, group, global');
          }
          updates.cli_scope = scope;
        }
        if (args.runtime !== undefined) {
          const runtime = args.runtime as string;
          const known = listRegisteredRuntimes();
          if (known.length > 0 && !known.includes(runtime)) {
            throw new Error(
              \`--runtime must be one of the registered runtimes: \${known.join(', ')} (got "\${runtime}")\`,
            );
          }
          updates.runtime = runtime;
        }
        if (args['session-transport'] !== undefined || args.session_transport !== undefined) {
          updates.session_transport = String(args['session-transport'] ?? args.session_transport);
        }

        if (Object.keys(updates).length === 0) {
          throw new Error(
            'Nothing to update — provide at least one of: --provider, --model, --effort, --image-tag, --assistant-name, --max-messages-per-prompt, --cli-scope, --runtime, --session-transport',
          );
        }`,
    ),
    "config update fields",
  );

  return content;
}

export function unpatchGroupsCli(source: string): string {
  let content = source;

  if (content.includes(begin("groups-config-update-fields"))) {
    content = replaceOnce(
      content,
      marked(
        "groups-config-update-fields",
        `        if (args['cli-scope'] !== undefined || args.cli_scope !== undefined) {
          const scope = (args['cli-scope'] ?? args.cli_scope) as string;
          if (!['disabled', 'group', 'global'].includes(scope)) {
            throw new Error('--cli-scope must be one of: disabled, group, global');
          }
          updates.cli_scope = scope;
        }
        if (args.runtime !== undefined) {
          const runtime = args.runtime as string;
          const known = listRegisteredRuntimes();
          if (known.length > 0 && !known.includes(runtime)) {
            throw new Error(
              \`--runtime must be one of the registered runtimes: \${known.join(', ')} (got "\${runtime}")\`,
            );
          }
          updates.runtime = runtime;
        }
        if (args['session-transport'] !== undefined || args.session_transport !== undefined) {
          updates.session_transport = String(args['session-transport'] ?? args.session_transport);
        }

        if (Object.keys(updates).length === 0) {
          throw new Error(
            'Nothing to update — provide at least one of: --provider, --model, --effort, --image-tag, --assistant-name, --max-messages-per-prompt, --cli-scope, --runtime, --session-transport',
          );
        }`,
      ),
      `        if (args['cli-scope'] !== undefined || args.cli_scope !== undefined) {
          const scope = (args['cli-scope'] ?? args.cli_scope) as string;
          if (!['disabled', 'group', 'global'].includes(scope)) {
            throw new Error('--cli-scope must be one of: disabled, group, global');
          }
          updates.cli_scope = scope;
        }

        if (Object.keys(updates).length === 0) {
          throw new Error(
            'Nothing to update — provide at least one of: --provider, --model, --effort, --image-tag, --assistant-name, --max-messages-per-prompt, --cli-scope',
          );
        }`,
      "restore config update fields",
    );
  }

  if (content.includes(begin("groups-config-update-type"))) {
    content = replaceOnce(
      content,
      marked("groups-config-update-type", PATCHED_SCALARS_PICK),
      STOCK_SCALARS_PICK,
      "restore groups pick type",
    );
  }

  if (content.includes(begin("groups-config-update-desc"))) {
    content = replaceOnce(
      content,
      marked(
        "groups-config-update-desc",
        `'Update container config scalar fields. Changes are saved but do NOT take effect until you run \`ncl groups restart\`. ' +
        'Use --id <group-id> and any of: --provider, --model, --effort, --image-tag, --assistant-name, --max-messages-per-prompt, --cli-scope, --runtime, --session-transport.',`,
      ),
      `'Update container config scalar fields. Changes are saved but do NOT take effect until you run \`ncl groups restart\`. ' +
        'Use --id <group-id> and any of: --provider, --model, --effort, --image-tag, --assistant-name, --max-messages-per-prompt, --cli-scope.',`,
      "restore config update description",
    );
  }

  if (content.includes(begin("groups-create-runtime"))) {
    content = replaceOnce(
      content,
      marked(
        "groups-create-runtime",
        `        initGroupFilesystem(group);
        if (args.runtime !== undefined || args['session-transport'] !== undefined || args.session_transport !== undefined) {
          const stamped: Partial<Pick<ContainerConfigRow, 'runtime' | 'session_transport'>> = {};
          if (args.runtime !== undefined) {
            const runtime = String(args.runtime);
            const known = listRegisteredRuntimes();
            if (known.length > 0 && !known.includes(runtime)) {
              throw new Error(
                \`--runtime must be one of the registered runtimes: \${known.join(', ')} (got "\${runtime}")\`,
              );
            }
            stamped.runtime = runtime;
          }
          const transport = args['session-transport'] ?? args.session_transport;
          if (transport !== undefined) stamped.session_transport = String(transport);
          updateContainerConfigScalars(id, stamped);
        }
        return getAgentGroupByFolder(folder);
      },
    },
    delete: {`,
      ),
      `        initGroupFilesystem(group);
        return getAgentGroupByFolder(folder);
      },
    },
    delete: {`,
      "restore groups create",
    );
  }

  if (content.includes(begin("groups-present-config"))) {
    content = replaceOnce(
      content,
      marked(
        "groups-present-config",
        `    cli_scope: row.cli_scope,
    runtime: row.runtime,
    session_transport: row.session_transport,
    updated_at: row.updated_at,
  };
}`,
      ),
      `    cli_scope: row.cli_scope,
    updated_at: row.updated_at,
  };
}`,
      "restore presentConfig",
    );
  }

  content = removeMarkedBlock(content, "groups-agenthosts-import");

  return content;
}

export const FILE_TRANSFORMS: FileTransform[] = [
  {
    path: "src/container-runner.ts",
    transform: patchContainerRunner,
    uninstall: unpatchContainerRunner,
  },
  {
    path: "src/index.ts",
    transform: patchIndex,
    uninstall: unpatchIndex,
  },
  {
    path: "src/types.ts",
    transform: patchTypes,
    uninstall: unpatchTypes,
  },
  {
    path: "src/db/container-configs.ts",
    transform: patchContainerConfigsDb,
    uninstall: unpatchContainerConfigsDb,
  },
  {
    path: "src/db/migrations/index.ts",
    transform: patchMigrationsIndex,
    uninstall: unpatchMigrationsIndex,
  },
  {
    path: "src/cli/resources/groups.ts",
    transform: patchGroupsCli,
    uninstall: unpatchGroupsCli,
  },
];
