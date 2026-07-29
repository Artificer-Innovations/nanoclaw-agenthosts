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
): string {
  if (content.includes(begin(name))) return content;
  const firstImport = content.search(/^import /m);
  if (firstImport < 0)
    throw new Error(`Could not find import anchor for ${name}`);
  const block = `${begin(name)}\nimport { ${symbols.join(", ")} } from '${modulePath}';\n${end(name)}\n`;
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

export function patchContainerRunner(source: string): string {
  const coreNames = [
    "container-import",
    "is-running-rename",
    "wake-rename",
    "kill-rename",
    "docker-register",
    "public-exports",
  ];

  // Already installed (v1): ensure sessions import + refresh public-exports body.
  if (coreNames.every((name) => source.includes(begin(name)))) {
    let content = installImport(
      source,
      "./db/sessions.js",
      ["getSession"],
      "sessions-import",
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
    [
      "registerRuntimeDriver",
      "resolveRuntimeDriver",
      "setContainerConfigReader",
    ],
    "container-import",
  );

  content = installImport(
    content,
    "./db/sessions.js",
    ["getSession"],
    "sessions-import",
  );

  if (content.includes(STOCK_RUNTIME_IMPORT)) {
    content = replaceOnce(
      content,
      STOCK_RUNTIME_IMPORT,
      PATCHED_RUNTIME_IMPORT,
      "cleanupOrphans import",
    );
  } else if (!/cleanupOrphans/.test(content)) {
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

function publicExportsBody(): string {
  return `export function isContainerRunning(sessionId: string): boolean {
  try {
    const session = getSession(sessionId);
    if (session) return resolveRuntimeDriver(session).isRunning(sessionId);
  } catch (err) {
    log.debug('isContainerRunning driver resolve failed — falling back to docker map', {
      sessionId,
      err,
    });
  }
  return isContainerRunningDocker(sessionId);
}

export function wakeContainer(session: Session): Promise<boolean> {
  try {
    return resolveRuntimeDriver(session).wake(session, {});
  } catch (err) {
    log.warn('wakeContainer failed — host-sweep will retry', { sessionId: session.id, err });
    return Promise.resolve(false);
  }
}

export function killContainer(sessionId: string, reason: string, onExit?: () => void): void {
  try {
    const session = getSession(sessionId);
    if (session) {
      resolveRuntimeDriver(session).kill(sessionId, reason, onExit);
      return;
    }
  } catch (err) {
    log.warn('killContainer driver resolve failed — falling back to docker kill', {
      sessionId,
      err,
    });
  }
  killContainerDocker(sessionId, reason, onExit);
}`;
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
    marked("public-exports", publicExportsBody()) +
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
    "groups-present-config",
    "groups-create-runtime",
    "groups-config-update-desc",
    "groups-config-update-type",
    "groups-config-update-fields",
  ];
  if (isFullyPatched(source, names)) return source;

  let content = replaceOnce(
    source,
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
          if (args.runtime !== undefined) stamped.runtime = String(args.runtime);
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
        if (args.runtime !== undefined) updates.runtime = args.runtime as string;
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
        if (args.runtime !== undefined) updates.runtime = args.runtime as string;
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
          if (args.runtime !== undefined) stamped.runtime = String(args.runtime);
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
