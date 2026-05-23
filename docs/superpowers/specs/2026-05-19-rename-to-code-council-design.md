# Design Spec: Rename Project Fork to Code Council

A comprehensive blueprint to rename the application from "Chorus" to "Code Council" across CLI commands, environment variables, settings paths, database structure, and user-facing branding, including seamless auto-migration for existing users.

---

## 1. Naming Standards

To maintain a clean and professional architecture, we will adopt the following naming standards:

| Brand Element | Original (Chorus) | New (Code Council) |
| :--- | :--- | :--- |
| **Brand Name** | Chorus | Code Council |
| **CLI Command** | `chorus` | `council` |
| **CLI Bin Entry** | `bin/chorus.mjs` | `bin/council.mjs` |
| **Settings Directory** | `~/.chorus` | `~/.code-council` |
| **Database File** | `~/.chorus/chorus.db` | `~/.code-council/council.db` |
| **Package Name** | `chorus-codes` | `code-council` |
| **Environment Prefix** | `CHORUS_` | `COUNCIL_` |
| **MCP Server ID** | `chorus` | `council` |

---

## 2. Environment Variables Mapping

All environment variables will be migrated to use the `COUNCIL_` prefix. Code references using `process.env.CHORUS_*` will be refactored:

*   `CHORUS_CODEX_HOME` ➔ `COUNCIL_CODEX_HOME`
*   `CHORUS_KIMI_TRANSPORT` ➔ `COUNCIL_KIMI_TRANSPORT`
*   `CHORUS_DAEMON_PORT` ➔ `COUNCIL_DAEMON_PORT` (Default: `7707`)
*   `CHORUS_COCKPIT_PORT` ➔ `COUNCIL_COCKPIT_PORT` (Default: `5050`)
*   `CHORUS_REPO_PATH` ➔ `COUNCIL_REPO_PATH`
*   `CHORUS_DAEMON_URL` ➔ `COUNCIL_DAEMON_URL`
*   `CHORUS_COCKPIT_URL` ➔ `COUNCIL_COCKPIT_URL`
*   `CHORUS_DB_PATH` ➔ `COUNCIL_DB_PATH`
*   `CHORUS_LOG_LEVEL` ➔ `COUNCIL_LOG_LEVEL`
*   `CHORUS_TRANSPORT` ➔ `COUNCIL_TRANSPORT`
*   `CHORUS_TELEMETRY` ➔ `COUNCIL_TELEMETRY`
*   `CHORUS_AUTOSTART` ➔ `COUNCIL_AUTOSTART`
*   `CHORUS_WEB_URL` ➔ `COUNCIL_WEB_URL`

---

## 3. CLI and Package Renaming

### 3.1. Binary and package.json
*   Rename `bin/chorus.mjs` to `bin/council.mjs`.
*   Update `package.json` to publish under the name `code-council` and register the `council` binary command.
*   Update development and daemon startup scripts in `package.json` to reference `COUNCIL_` variables.

### 3.2. CLI Parser (`src/cli/index.ts`)
*   Update command descriptions, CLI options, and console output to display `council` and `Code Council`.
*   Update helper functions that resolve running daemon PIDs and pathing to read from `~/.code-council`.

---

## 4. Database & File Path Migration

### 4.1. Directory Structure Change
We will transition the storage folder from `~/.chorus` to `~/.code-council` inside `src/lib/db/connection.ts` and other path resolution helpers.

### 4.2. Auto-Migration Sequence
To prevent data loss for existing users, we will insert an auto-migration check in `src/lib/db/connection.ts` inside `initDb()` before any SQL clients are created or schemas are evaluated:

```typescript
import fs from 'fs';
import os from 'os';
import path from 'path';

function runDataMigration() {
  const newDir = path.join(os.homedir(), '.code-council');
  const oldDir = path.join(os.homedir(), '.chorus');

  // Check if target doesn't exist but legacy does
  if (!fs.existsSync(newDir) && fs.existsSync(oldDir)) {
    try {
      // 1. Create ~/.code-council with restrictive owner permissions
      fs.mkdirSync(newDir, { recursive: true, mode: 0o700 });

      // 2. Recursively copy all custom templates, logs, chats, crashes
      copyDirRecursive(oldDir, newDir);

      // 3. Rename database file and sidecars to the new naming scheme
      const oldDbFile = path.join(newDir, 'chorus.db');
      const newDbFile = path.join(newDir, 'council.db');
      if (fs.existsSync(oldDbFile)) {
        fs.renameSync(oldDbFile, newDbFile);
      }
      
      const sidecars = ['-wal', '-shm', '-journal'];
      for (const ext of sidecars) {
        const oldSidecar = oldDbFile + ext;
        const newSidecar = newDbFile + ext;
        if (fs.existsSync(oldSidecar)) {
          fs.renameSync(oldSidecar, newSidecar);
        }
      }

      console.log(`[migration] Successfully migrated legacy Chorus data from ${oldDir} to ${newDir}`);
    } catch (err) {
      console.error(`[migration] Warning: Failed to migrate legacy folder:`, err);
    }
  }
}

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
      // Retain owner read/write permissions
      fs.chmodSync(destPath, 0o600);
    }
  }
}
```

---

## 5. UI Branding Renames

We will update the Next.js frontend pages and visual components in `src/app/` and `src/components/` to present the **Code Council** brand.

*   Page Titles and Layout Meta.
*   Onboarding and CLI integration cards (instructing users to register the `council` server in their config files instead of `chorus`).
*   Telemetry status and Settings panel wording.

---

## 6. MCP Server Integration Renames

*   Update MCP server declaration (`src/mcp/index.ts`) to advertise the server name as `council`.
*   Update default JSON configurations generated during CLI setup (`src/lib/cli-detect.ts`) so they write a `council` server config block instead of `chorus`.
