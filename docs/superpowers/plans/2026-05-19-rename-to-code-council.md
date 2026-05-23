# Code Council Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completely rename the fork from "Chorus" to "Code Council" across all codebase files, configs, CLI binaries, variables, and documentation, including an auto-migration script for legacy users.

**Architecture:** We will systematically refactor variables, directories, and texts under a unified mapping (`council` CLI, `~/.code-council` path, `COUNCIL_` envs). An auto-migration step will be injected into `initDb` in `connection.ts` to cleanly transition old user folders.

**Tech Stack:** Node.js, Next.js, SQLite (via @libsql/client), Commander.js, TS/JS.

---

### Task 1: Environment Variables, Paths, and Database Auto-Migration

**Files:**
- Modify: `src/lib/db/connection.ts`
- Modify: `src/lib/daemon-discovery.ts`
- Test: Run connection test or compile verification.

- [ ] **Step 1: Implement environment mapping, defaults, and recursive copy migration logic in `src/lib/db/connection.ts`**
  Show the updated import and function definitions in `src/lib/db/connection.ts`:
  
  ```typescript
  // In src/lib/db/connection.ts
  
  import { createClient, type Client } from '@libsql/client';
  import { readFileSync } from 'fs';
  import fs from 'fs';
  import os from 'os';
  import path from 'path';
  
  // Custom directory copy helper for migration
  function copyDirRecursive(src: string, dest: string) {
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(destPath, { recursive: true, mode: 0o700 });
        copyDirRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
        fs.chmodSync(destPath, 0o600);
      }
    }
  }
  
  // Check and run data migration from ~/.chorus to ~/.code-council
  function runLegacyDataMigration() {
    const oldDir = path.join(os.homedir(), '.chorus');
    const newDir = path.join(os.homedir(), '.code-council');
    
    if (!fs.existsSync(newDir) && fs.existsSync(oldDir)) {
      try {
        fs.mkdirSync(newDir, { recursive: true, mode: 0o700 });
        copyDirRecursive(oldDir, newDir);
        
        // Rename database and sidecar files
        const oldDb = path.join(newDir, 'chorus.db');
        const newDb = path.join(newDir, 'council.db');
        if (fs.existsSync(oldDb)) {
          fs.renameSync(oldDb, newDb);
        }
        
        for (const ext of ['-wal', '-shm', '-journal']) {
          if (fs.existsSync(oldDb + ext)) {
            fs.renameSync(oldDb + ext, newDb + ext);
          }
        }
        console.log(`[migration] Successfully migrated legacy Chorus data to ${newDir}`);
      } catch (err) {
        console.error(`[migration] Error migrating legacy folder:`, err);
      }
    }
  }
  
  export function resolveDbPath(): string {
    const override = process.env.COUNCIL_DB_PATH || process.env.CHORUS_DB_PATH;
    if (override) return override;
    return path.join(os.homedir(), '.code-council', 'council.db');
  }
  ```

- [ ] **Step 2: Hook up `runLegacyDataMigration` at the start of `initDb()` in `src/lib/db/connection.ts`**
  Modify lines inside `initDb` to run the migration and secure paths:
  
  ```typescript
  async function initDb(): Promise<Client> {
    // Run auto-migration if present
    runLegacyDataMigration();
    
    const dbPath = resolveDbPath();
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true, mode: 0o700 });
    } else if (path.basename(dbDir) === '.code-council') {
      try {
        fs.chmodSync(dbDir, 0o700);
      } catch {}
    }
    const isNew = !fs.existsSync(dbPath);
    const db = createClient({ url: `file:${dbPath}` });
    
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`]) {
      try {
        if (fs.existsSync(f)) fs.chmodSync(f, 0o600);
      } catch {}
    }
    // ... rest of schema creation
  ```

- [ ] **Step 3: Update environmental variables in `src/lib/daemon-discovery.ts`**
  Modify path resolution to read `COUNCIL_` env variables fallback to `CHORUS_`:
  
  ```typescript
  // In src/lib/daemon-discovery.ts
  const daemonUrl = process.env.COUNCIL_DAEMON_URL || process.env.CHORUS_DAEMON_URL;
  const cockpitUrl = process.env.COUNCIL_COCKPIT_URL || process.env.CHORUS_COCKPIT_URL;
  // Use path.join(os.homedir(), '.code-council') for finding daemon.pid / daemon.json
  ```

- [ ] **Step 4: Commit**
  Run: `git commit -am "feat: implement environment mappings, path updates, and auto-migration"`

---

### Task 2: CLI Rename and Binary Setup

**Files:**
- Create: `bin/council.mjs` (renamed from `bin/chorus.mjs`)
- Modify: `package.json`
- Modify: `src/cli/index.ts`
- Modify: `src/cli/commands/doctor.ts`

- [ ] **Step 1: Rename the binary file and update package configurations**
  Rename the file: `mv bin/chorus.mjs bin/council.mjs`
  
  Update `package.json`:
  ```json
  "name": "code-council",
  "bin": {
    "council": "./bin/council.mjs"
  },
  "scripts": {
    "dev": "next dev -p 5050 -H 127.0.0.1",
    "dev:daemon": "tsx watch src/daemon/index.ts",
    "dev:mcp": "tsx src/mcp/index.ts",
    "build": "next build --webpack",
    "start": "next start -p 5050 -H 127.0.0.1"
  }
  ```

- [ ] **Step 2: Modify the CLI definitions in `src/cli/index.ts`**
  Update help menus, binary name in commander:
  ```typescript
  import { program } from 'commander';
  program
    .name('council')
    .description('Code Council: Peer review for code decisions by multiple LLMs')
    .version('0.8.43');
  ```

- [ ] **Step 3: Update directory path references in CLI command actions**
  Make sure all commands like `doctor`, `init`, `start`, `stop`, `status` reference the `.code-council` directory instead of `.chorus`.
  
- [ ] **Step 4: Commit**
  Run: `git commit -am "feat: rename CLI binary to council and update package.json"`

---

### Task 3: MCP Server and Client Registry Renames

**Files:**
- Modify: `src/mcp/index.ts`
- Modify: `src/lib/cli-detect.ts`

- [ ] **Step 1: Rename MCP server ID to `council`**
  Update the MCP server name inside `src/mcp/index.ts`:
  ```typescript
  const server = new Server({
    name: 'council',
    version: '0.8.43',
  }, {
    capabilities: { tools: {} }
  });
  ```

- [ ] **Step 2: Update MCP configuration templates inside `src/lib/cli-detect.ts`**
  When registering Code Council with IDEs (Claude Code, Cursor, Codex), use `council` as the server key instead of `chorus`:
  ```typescript
  // Replace references of mcpServers.chorus with mcpServers.council
  ```

- [ ] **Step 3: Commit**
  Run: `git commit -am "feat: rename MCP server configuration and client registry key"`

---

### Task 4: Next.js Web UI Branding Rename

**Files:**
- Modify: `src/app/layout.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/onboarding/page.tsx`
- Modify: `src/app/onboarding/cli-section.tsx`
- Modify: `src/app/onboarding/api-keys-section.tsx`

- [ ] **Step 1: Update UI layout titles and metadata**
  Open `src/app/layout.tsx` and rename meta title to "Code Council" or "Code Council Cockpit".
  
- [ ] **Step 2: Update user onboarding guides and wording**
  Replace references to "Chorus" or "chorus start" with "Code Council" and "council start".
  
- [ ] **Step 3: Commit**
  Run: `git commit -am "feat: update Cockpit web UI branding to Code Council"`

---

### Task 5: Documentation Update

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/` (Self references)

- [ ] **Step 1: Update README.md quickstart and guide**
  Replace brand terms and install snippets with `npm i -g code-council` and `council start`.
  
- [ ] **Step 2: Commit**
  Run: `git commit -am "docs: update README.md and guides to reflect Code Council branding"`
