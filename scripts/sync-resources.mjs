#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function copy(source, destination) {
  const target = path.join(root, destination);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(root, source), target);
}

copy("packages/shared/src/warn-once.ts", "packages/host/src/warn-once.ts");
copy(
  "packages/shared/src/warn-once.ts",
  "skills/add-agenthosts/resources/host/warn-once.ts",
);
copy(
  "packages/host/src/agenthosts.ts",
  "skills/add-agenthosts/resources/host/agenthosts.ts",
);
copy(
  "packages/host/src/020-agenthosts-runtime.ts",
  "skills/add-agenthosts/resources/host/020-agenthosts-runtime.ts",
);
console.log("Synced agenthosts resources");
