/** Minimal NanoClaw source snippets with the anchors agenthosts patches expect. */

export const fixtureSources = {
  containerRunner: `/**
 * Container Runner fixture
 */
// @nanoclaw-hosthooks:container-import:begin
import { runContainerEnvContributors } from './hosthooks.js';
// @nanoclaw-hosthooks:container-import:end
import { ChildProcess, spawn } from 'child_process';
import { getDb, hasTable } from './db/connection.js';
import { getContainerConfig } from './db/container-configs.js';
import { CONTAINER_RUNTIME_BIN, hostGatewayArgs, readonlyMountArgs, stopContainer } from './container-runtime.js';
import { log } from './log.js';
import { writeSessionRouting } from './session-manager.js';
import type { Session } from './types.js';

const activeContainers = new Map<string, { process: ChildProcess; containerName: string }>();

export function getActiveContainerCount(): number {
  return activeContainers.size;
}

export function isContainerRunning(sessionId: string): boolean {
  return activeContainers.has(sessionId);
}

export function wakeContainer(session: Session): Promise<boolean> {
  if (activeContainers.has(session.id)) {
    return Promise.resolve(true);
  }
  return Promise.resolve(true);
}

export function killContainer(sessionId: string, reason: string, onExit?: () => void): void {
  const entry = activeContainers.get(sessionId);
  if (!entry) return;
  if (onExit) entry.process.once('close', onExit);
  try {
    stopContainer(entry.containerName);
  } catch {
    entry.process.kill('SIGKILL');
  }
}

export async function buildAgentGroupImage(): Promise<void> {}
`,

  index: `import { ensureContainerRuntimeRunning, cleanupOrphans } from './container-runtime.js';
import { log } from './log.js';

async function main(): Promise<void> {
  log.info('NanoClaw starting');
  ensureContainerRuntimeRunning();
  cleanupOrphans();
  log.info('ready');
}

main();
`,

  types: `export interface ContainerConfigRow {
  agent_group_id: string;
  provider: string | null;
  model: string | null;
  effort: string | null;
  image_tag: string | null;
  assistant_name: string | null;
  max_messages_per_prompt: number | null;
  skills: string;
  mcp_servers: string;
  packages_apt: string;
  packages_npm: string;
  additional_mounts: string;
  cli_scope: string; // 'disabled' | 'group' | 'global'
  updated_at: string;
}
`,

  containerConfigs: `import { DEFAULT_AGENT_PROVIDER } from '../config.js';
import type { ContainerConfigRow } from '../types.js';
import { getDb } from './connection.js';

const SCALAR_COLUMNS = new Set([
  'provider',
  'model',
  'effort',
  'image_tag',
  'assistant_name',
  'max_messages_per_prompt',
  'cli_scope',
]);
const JSON_COLUMNS = new Set(['skills', 'mcp_servers', 'packages_apt', 'packages_npm', 'additional_mounts']);

export function getContainerConfig(agentGroupId: string): ContainerConfigRow | undefined {
  return undefined;
}

export function updateContainerConfigScalars(
  agentGroupId: string,
  updates: Partial<
    Pick<
      ContainerConfigRow,
      'provider' | 'model' | 'effort' | 'image_tag' | 'assistant_name' | 'max_messages_per_prompt' | 'cli_scope'
    >
  >,
): void {
  void agentGroupId;
  void updates;
}
`,

  migrationsIndex: `import type Database from 'better-sqlite3';
import { migration019 } from './019-wiring-threads.js';

export interface Migration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
}

export const migrations: Migration[] = [
  migration019,
];
`,

  groups: `import {
  getContainerConfig,
  updateContainerConfigScalars,
  updateContainerConfigJson,
} from '../../db/container-configs.js';
import { initGroupFilesystem } from '../../group-init.js';
import type { AgentGroup, ContainerConfigRow } from '../../types.js';

function presentConfig(row: ContainerConfigRow): Record<string, unknown> {
  return {
    agent_group_id: row.agent_group_id,
    provider: row.provider,
    model: row.model,
    effort: row.effort,
    image_tag: row.image_tag,
    assistant_name: row.assistant_name,
    max_messages_per_prompt: row.max_messages_per_prompt,
    skills: JSON.parse(row.skills),
    mcp_servers: JSON.parse(row.mcp_servers),
    packages_apt: JSON.parse(row.packages_apt),
    packages_npm: JSON.parse(row.packages_npm),
    additional_mounts: JSON.parse(row.additional_mounts),
    cli_scope: row.cli_scope,
    updated_at: row.updated_at,
  };
}

const handlers = {
    create: {
      handler: async (args: Record<string, unknown>) => {
        const folder = args.folder as string;
        const id = 'ag-test';
        const group = { id, name: folder, folder } as AgentGroup;
        initGroupFilesystem(group);
        return getAgentGroupByFolder(folder);
      },
    },
    delete: {
      handler: async () => ({}),
    },
    'config update': {
      description:
        'Update container config scalar fields. Changes are saved but do NOT take effect until you run \`ncl groups restart\`. ' +
        'Use --id <group-id> and any of: --provider, --model, --effort, --image-tag, --assistant-name, --max-messages-per-prompt, --cli-scope.',
      handler: async (args: Record<string, unknown>) => {
        const id = args.id as string;
        const updates: Partial<
          Pick<
            ContainerConfigRow,
            'provider' | 'model' | 'effort' | 'image_tag' | 'assistant_name' | 'max_messages_per_prompt' | 'cli_scope'
          >
        > = {};
        if (args.provider !== undefined) updates.provider = args.provider as string;
        if (args['cli-scope'] !== undefined || args.cli_scope !== undefined) {
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
        }
        updateContainerConfigScalars(id, updates);
        return presentConfig(getContainerConfig(id)!);
      },
    },
};

function getAgentGroupByFolder(folder: string): AgentGroup {
  return { id: 'ag-test', name: folder, folder, agent_provider: null, created_at: '' };
}
`,
};

export function writeFixtureTree(
  root: string,
  fs: typeof import("node:fs"),
  path: typeof import("node:path"),
): void {
  const files: Record<string, string> = {
    "src/router.ts": "export {};\n",
    "container/agent-runner/src/poll-loop.ts": "export {};\n",
    "src/container-runner.ts": fixtureSources.containerRunner,
    "src/index.ts": fixtureSources.index,
    "src/types.ts": fixtureSources.types,
    "src/db/container-configs.ts": fixtureSources.containerConfigs,
    "src/db/migrations/index.ts": fixtureSources.migrationsIndex,
    "src/db/sessions.ts": `export function getSession(
  sessionId: string,
): { id: string; agent_group_id: string } | undefined {
  void sessionId;
  return undefined;
}
`,
    "src/cli/resources/groups.ts": fixtureSources.groups,
  };
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
  }
}
