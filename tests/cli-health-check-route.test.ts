import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerSystemRoutes } from '@/daemon/routes/system';
import { getHealth, recordHealth } from '@/lib/cli-health';
import { _resetDbForTests } from '@/lib/db/connection';
import { voices } from '@/lib/db/voices';

let dbPath: string;
let fakeHome: string;
let realHome: string | undefined;

beforeEach(async () => {
  dbPath = path.join(os.tmpdir(), `chorus-health-check-${randomUUID()}.db`);
  process.env.CHORUS_DB_PATH = dbPath;
  await _resetDbForTests();

  realHome = process.env.HOME;
  fakeHome = path.join(os.tmpdir(), `chorus-health-home-${randomUUID()}`);
  fs.mkdirSync(fakeHome, { recursive: true });
  process.env.HOME = fakeHome;
});

afterEach(async () => {
  await _resetDbForTests();
  for (const suffix of ['', '-shm', '-wal']) {
    try {
      fs.unlinkSync(dbPath + suffix);
    } catch {
      /* best-effort */
    }
  }
  delete process.env.CHORUS_DB_PATH;

  try {
    fs.rmSync(fakeHome, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
  if (realHome) process.env.HOME = realHome;
  else delete process.env.HOME;
});

function writeFakeCred(relPath: string): void {
  const full = path.join(fakeHome, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, '{"oauth":"fake"}');
}

function makeApp() {
  const app = Fastify({ logger: false });
  registerSystemRoutes(app, {
    chorusBinPath: '/tmp/chorus.mjs',
    version: '0.0.0-test',
  });
  return app;
}

describe('POST /cli/health/check', () => {
  it('marks an enabled CLI voice active when precheck passes', async () => {
    writeFakeCred('.codex/auth.json');
    await voices.upsert({
      id: 'codex-cli:gpt-5.5',
      label: 'GPT 5.5',
      source: 'cli',
      provider: 'codex-cli',
      model_id: 'gpt-5.5',
      lineage: 'openai',
      enabled: true,
    });

    const app = makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/cli/health/check',
      payload: { voiceId: 'codex-cli:gpt-5.5' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      data: {
        ok: true,
        voiceId: 'codex-cli:gpt-5.5',
        health: { lineage: 'openai', status: 'healthy' },
      },
    });
    await expect(getHealth('openai')).resolves.toMatchObject({
      status: 'healthy',
    });
    await app.close();
  });

  it('keeps a quota-blocked voice out of active state', async () => {
    writeFakeCred('.codex/auth.json');
    const resetAt = Date.now() + 60_000;
    await recordHealth({
      lineage: 'openai',
      status: 'quota_exhausted',
      message: 'quota reached',
      resetAt,
    });
    await voices.upsert({
      id: 'codex-cli:gpt-5.5',
      label: 'GPT 5.5',
      source: 'cli',
      provider: 'codex-cli',
      model_id: 'gpt-5.5',
      lineage: 'openai',
      enabled: true,
    });

    const app = makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/cli/health/check',
      payload: { voiceId: 'codex-cli:gpt-5.5' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      data: {
        ok: false,
        voiceId: 'codex-cli:gpt-5.5',
        health: { lineage: 'openai', status: 'quota_exhausted', resetAt },
      },
    });
    await app.close();
  });
});
