#!/usr/bin/env node
// Chorus CLI entry. Resolves dist/ when published, falls back to tsx for dev.

// Hard-gate Node version BEFORE any imports — package.json sets engines.node
// >=20 but npm only WARNS on engine mismatch unless engine-strict is set
// (and almost no user has that). Without this gate a Node 18 user hits a
// stack of cryptic ESM/native errors instead of a one-line message.
const [nodeMajor] = process.versions.node.split(".").map(Number);
if (nodeMajor < 20) {
  console.error(
    `\n  ✗ Chorus requires Node 20 or newer (you have ${process.versions.node}).\n  Install latest LTS from https://nodejs.org/ or via your version manager (nvm, fnm, asdf).\n`,
  );
  process.exit(1);
}

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distEntry = resolve(__dirname, "../dist/cli/index.js");

if (existsSync(distEntry)) {
  await import(distEntry);
} else {
  // Dev / unpublished install — register tsx and run from src.
  const tsx = await import("tsx/esm/api");
  tsx.register();
  await import(resolve(__dirname, "../src/cli/index.ts"));
}
