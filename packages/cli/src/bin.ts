#!/usr/bin/env node
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findNanoclawRoot } from "./paths.js";
import {
  printInstallNextSteps,
  runInstall,
  runUninstall,
  runUpgrade,
  runVerify,
  syncSkillToFork,
} from "./install.js";

export function parseArgs(argv: string[]): { command: string; path?: string } {
  const args = argv.slice(2);
  const command = args[0] ?? "help";
  let pathArg: string | undefined;
  for (let index = 1; index < args.length; index += 1) {
    if (args[index] === "--path" && args[index + 1]) {
      pathArg = args[index + 1];
      index += 1;
    }
  }
  return { command, path: pathArg };
}

export function runCommand(argv: string[]): number {
  const { command, path: root } = parseArgs(argv);
  try {
    switch (command) {
      case "install": {
        printInstallNextSteps(runInstall(root));
        return 0;
      }
      case "upgrade": {
        printInstallNextSteps(runUpgrade(root), { upgraded: true });
        return 0;
      }
      case "sync-skill": {
        const nanoclawRoot = root ?? findNanoclawRoot();
        console.log(`Synced skill → ${syncSkillToFork(nanoclawRoot)}`);
        return 0;
      }
      case "verify": {
        const result = runVerify(root);
        if (!result.ok) {
          console.error("Verification failed:");
          for (const issue of result.issues) console.error(`  - ${issue}`);
          return 1;
        }
        console.log(`Verification passed for ${result.root}`);
        return 0;
      }
      case "uninstall": {
        const result = runUninstall(root);
        console.log(`Removed agenthosts from ${result.root}`);
        console.log(
          `Restored ${result.changed.length} files; removed ${result.removed.length} resources.`,
        );
        console.log("\nOptional: pnpm remove nanoclaw-agenthosts");
        console.log("Then: pnpm run build && restart host");
        return 0;
      }
      default:
        console.log(`Usage: nanoclaw-agenthosts <command> [--path <nanoclaw-root>]

Commands:
  install      Install RuntimeDriver registry + docker default + runtime config
  upgrade      Re-apply the idempotent installer
  sync-skill   Copy the bundled skill to .claude/skills/add-agenthosts/
  verify       Verify markers, copied modules, and migration wiring
  uninstall    Restore stock call sites and remove registry modules
`);
        return command === "help" ? 0 : 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 1;
  }
}

export function isCliEntry(
  metaUrl: string,
  argv1: string | undefined,
): boolean {
  if (!argv1) return false;
  try {
    return (
      realpathSync(fileURLToPath(metaUrl)) === realpathSync(path.resolve(argv1))
    );
  } catch {
    return false;
  }
}

export function main(argv: string[] = process.argv): number {
  return runCommand(argv);
}

if (isCliEntry(import.meta.url, process.argv[1])) {
  process.exitCode = main();
}
