/**
 * Council DB seam — backed by @libsql/client (napi-rs prebuilt for every
 * platform; no node-gyp at install time). Migrated from better-sqlite3 in
 * v0.7 to fix `npm install -g` reliability on Windows + locked-down dev
 * machines (planning/libsql-migration.md).
 *
 * SQL dialect + on-disk format are unchanged — same SQLite3 file at
 * ~/.code-council/council.db. Existing user DBs open cleanly.
 */

import { createClient, type Client } from '@libsql/client';
import { readFileSync } from 'fs';
import fs from 'fs';
import os from 'os';
import path from 'path';

let dbInstance: Client | null = null;
let dbInitPromise: Promise<Client> | null = null;

/**
 * Resolve DB path lazily inside getDb() rather than at module load. Two
 * reasons:
 *   1. COUNCIL_DB_PATH env override only takes effect if read at init time.
 *      A module-level `const dbPath = ...` evaluates once on import and is
 *      then frozen, so tests setting the env after import would have no
 *      effect.
 *   2. Tests need to swap DBs between cases without restarting the
 *      process — see `_resetDbForTests()`.
 */
export function resolveDbPath(): string {
  const override = process.env.COUNCIL_DB_PATH || process.env.CHORUS_DB_PATH;
  if (override) return override;
  return path.join(os.homedir(), '.code-council', 'council.db');
}

function resolveSchemaPath(): string {
  // dist/lib/db/connection.js needs ../db/schema.sql; src/lib/db/
  // connection.ts in tsx-watch dev mode resolves the same way. build:server
  // copies the .sql alongside the compiled .js (see package.json).
  return path.join(__dirname, '..', 'db', 'schema.sql');
}

export async function getDb(): Promise<Client> {
  if (dbInstance) return dbInstance;
  if (dbInitPromise) return dbInitPromise;

  dbInitPromise = initDb()
    .then((db) => {
      dbInstance = db;
      return db;
    })
    .catch((err: unknown) => {
      // CRITICAL: clear the cached promise on failure. Without this, a
      // single transient init error (corrupted DB, FS hiccup, permission
      // glitch) would lock the daemon forever — every subsequent getDb()
      // call would return the same rejected promise until restart.
      dbInitPromise = null;
      throw err;
    });

  return dbInitPromise;
}

function copyDirRecursive(src: string, dest: string) {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (!fs.existsSync(destPath)) {
        fs.mkdirSync(destPath, { recursive: true, mode: 0o700 });
      }
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
      fs.chmodSync(destPath, 0o600);
    }
  }
}

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
        const oldFile = oldDb + ext;
        const newFile = newDb + ext;
        if (fs.existsSync(oldFile)) {
          fs.renameSync(oldFile, newFile);
        }
      }
      console.log(`[migration] Successfully migrated legacy Chorus data to ${newDir}`);
    } catch (err) {
      console.error(`[migration] Error migrating legacy folder:`, err);
    }
  }
}

async function initDb(): Promise<Client> {
  // Run auto-migration if present before accessing SQLite database
  runLegacyDataMigration();

  const dbPath = resolveDbPath();
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    // 0700: only the owner traverses ~/.code-council. Without this the dir
    // inherits umask (typically 0755 → world-traversable), which lets
    // other local users `cat ~/.code-council/council.db` and read every API
    // key in the secrets table. Audit A2 BLOCKER.
    fs.mkdirSync(dbDir, { recursive: true, mode: 0o700 });
  } else if (path.basename(dbDir) === '.code-council') {
    // Existing ~/.code-council — tighten retroactively on first boot.
    try {
      fs.chmodSync(dbDir, 0o700);
    } catch {
      /* non-fatal */
    }
  }
  const isNew = !fs.existsSync(dbPath);
  const db = createClient({ url: `file:${dbPath}` });

  // Lock down the SQLite file (and WAL/SHM sidecars when they appear)
  // to owner-only read/write. Best-effort on every boot — covers fresh
  // creation, retroactive hardening, and the case where a sidecar was
  // recreated by libsql with default umask after a rare crash.
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`]) {
    try {
      if (fs.existsSync(f)) fs.chmodSync(f, 0o600);
    } catch {
      /* non-fatal */
    }
  }

  // libsql defaults to WAL on local file URLs. Setting it explicitly
  // keeps the intent visible in code reviews; no-op if already WAL.
  await db.execute('PRAGMA journal_mode = WAL');

  // PRAGMA journal_mode=WAL creates the -wal/-shm sidecars if they
  // didn't already exist. Re-chmod now so a brand-new DB never lives
  // even briefly with default-umask permissions on the WAL file.
  // Round-tripping the chmod loop is cheaper than risking a fast
  // attacker who can read the WAL between init and first write.
  for (const f of [`${dbPath}-wal`, `${dbPath}-shm`]) {
    try {
      if (fs.existsSync(f)) fs.chmodSync(f, 0o600);
    } catch {
      /* non-fatal */
    }
  }

  if (isNew) {
    const schema = readFileSync(resolveSchemaPath(), 'utf-8');
    await db.executeMultiple(schema);
  }

  // Run idempotent column-add migrations on every startup, not just for
  // existing DBs. A fresh DB created from a stale dist/schema.sql (e.g.
  // when the build script forgot to copy the latest schema) would
  // otherwise skip these and crash on first INSERT.
  const cols = (await db.execute('PRAGMA table_info(chats)')).rows as unknown as { name: string }[];
  const has = (n: string): boolean => cols.some((c) => c.name === n);
  if (!has('repo_path')) await db.execute('ALTER TABLE chats ADD COLUMN repo_path TEXT');
  if (!has('pr_url')) await db.execute('ALTER TABLE chats ADD COLUMN pr_url TEXT');
  if (!has('ship_error')) await db.execute('ALTER TABLE chats ADD COLUMN ship_error TEXT');
  if (!has('artifact')) await db.execute('ALTER TABLE chats ADD COLUMN artifact TEXT');
  if (!has('verdict')) await db.execute('ALTER TABLE chats ADD COLUMN verdict TEXT');
  // Nullable for legacy rows; backfilled on first list-load. UNIQUE
  // partial index lets us resolve /runs/<slug> in O(1).
  if (!has('slug')) await db.execute('ALTER TABLE chats ADD COLUMN slug TEXT');
  // Frozen template JSON written once when the runner first fires; readers
  // prefer this over the live template by id so old runs don't change shape
  // when the user edits the template later. NULL on legacy rows is fine —
  // readers fall back to the live template lookup.
  if (!has('template_snapshot')) await db.execute('ALTER TABLE chats ADD COLUMN template_snapshot TEXT');
  await db.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_chats_slug ON chats(slug) WHERE slug IS NOT NULL');
  await backfillChatSlugs(db);

  // Personas — added in v0.7. Idempotent CREATE so DBs that pre-date
  // this version pick it up without a manual migration.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS personas (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      one_liner TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      recommended_lineage TEXT,
      builtin INTEGER NOT NULL DEFAULT 0,
      forked_from TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Voices — added in v0.7 (planning/voices.md).
  await db.execute(`
    CREATE TABLE IF NOT EXISTS voices (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      source TEXT NOT NULL,
      provider TEXT NOT NULL,
      model_id TEXT NOT NULL,
      lineage TEXT NOT NULL,
      vendor_family TEXT,
      input_cost_per_mtok REAL,
      output_cost_per_mtok REAL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  await db.execute('CREATE INDEX IF NOT EXISTS idx_voices_lineage ON voices(lineage)');
  await db.execute('CREATE INDEX IF NOT EXISTS idx_voices_provider ON voices(provider)');
  await db.execute('CREATE INDEX IF NOT EXISTS idx_voices_source ON voices(source)');
  await db.execute('CREATE INDEX IF NOT EXISTS idx_voices_enabled ON voices(enabled)');

  // disabled_reason — added so the seed can distinguish user-intent toggles
  // from transient auto-disables on missed CLI detection. Without this the
  // re-detect path can't safely re-enable rows; one flaky boot would leave
  // a voice silently disabled forever.
  const voiceCols = (await db.execute('PRAGMA table_info(voices)')).rows as unknown as { name: string }[];
  const hasVoiceCol = (n: string): boolean => voiceCols.some((c) => c.name === n);
  if (!hasVoiceCol('disabled_reason')) {
    await db.execute('ALTER TABLE voices ADD COLUMN disabled_reason TEXT');
  }

  // Boot migration: rename legacy gemini-cli provider entries to antigravity-cli.
  // Idempotent: WHERE clause ensures it only runs when old rows exist.
  // Two-step: delete any pre-existing antigravity-cli rows first to prevent
  // UNIQUE constraint collision on the id rename.
  // Run after voices table is created/verified so schema is always ready.
  await db.execute(`
    DELETE FROM voices
    WHERE id IN (
      SELECT REPLACE(g.id, 'gemini-cli', 'antigravity-cli')
      FROM voices g
      WHERE g.provider = 'gemini-cli'
    )
  `);
  await db.execute(`
    UPDATE voices
    SET id = REPLACE(id, 'gemini-cli', 'antigravity-cli'),
        provider = 'antigravity-cli'
    WHERE provider = 'gemini-cli'
  `);

  // is_complete on templates — added in v0.8.3 to gate "Use template"
  // when the seed adapter couldn't fill every slot from the user's
  // installed voices. Default 1 keeps existing rows usable.
  const templateCols = (await db.execute('PRAGMA table_info(templates)')).rows as unknown as { name: string }[];
  const hasTemplateCol = (n: string): boolean => templateCols.some((c) => c.name === n);
  if (!hasTemplateCol('is_complete')) {
    await db.execute('ALTER TABLE templates ADD COLUMN is_complete INTEGER NOT NULL DEFAULT 1');
  }

  return db;
}

/**
 * One-shot pre-existing-row backfill: any chat row with NULL slug gets
 * one generated from its `work` text. Idempotent — second run finds no
 * NULL rows and exits cheaply. Runs inside getDb() so it happens before
 * any route handler can SELECT a chat with a missing slug.
 *
 * Uniqueness via inline existsFn closure to avoid a circular import on
 * the chats module (which depends on getDb being done).
 */
async function backfillChatSlugs(db: Client): Promise<void> {
  const result = await db.execute(
    'SELECT id, work, template_id FROM chats WHERE slug IS NULL ORDER BY created_at ASC',
  );
  if (result.rows.length === 0) return;

  const { generateChatSlug } = await import('../chat-slug.js');
  for (const row of result.rows as unknown as { id: string; work: string; template_id: string }[]) {
    const slug = await generateChatSlug({
      work: row.work,
      templateId: row.template_id,
      existsFn: async (s) => {
        const r = await db.execute({
          sql: 'SELECT 1 FROM chats WHERE slug = ? LIMIT 1',
          args: [s],
        });
        return r.rows.length > 0;
      },
    });
    await db.execute({
      sql: 'UPDATE chats SET slug = ? WHERE id = ?',
      args: [slug, row.id],
    });
  }
}

/**
 * @internal — for tests only. Closes the singleton handle and clears the
 * cached instance so the next `getDb()` call re-initializes against the
 * current `COUNCIL_DB_PATH` env. Without this, vitest tests running in the
 * same module instance would all share the first DB they opened.
 */
export async function _resetDbForTests(): Promise<void> {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      /* best-effort */
    }
  }
  dbInstance = null;
  dbInitPromise = null;
}

export function generateUlid(): string {
  const now = Date.now();
  const randomBytes = crypto.getRandomValues(new Uint8Array(10));
  const timeBytes = now.toString(16).padStart(12, '0');
  const randBytes = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return (timeBytes + randBytes).toUpperCase();
}
