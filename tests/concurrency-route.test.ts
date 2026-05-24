import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerSettingsRoutes } from '@/daemon/routes/settings';
import { _resetDbForTests } from '@/lib/db/connection';

let dbPath: string;

beforeEach(async () => {
  dbPath = path.join(os.tmpdir(), `chorus-concurrency-route-${randomUUID()}.db`);
  process.env.CHORUS_DB_PATH = dbPath;
  await _resetDbForTests();
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
});

function makeApp() {
  const app = Fastify({ logger: false });
  registerSettingsRoutes(app);
  return app;
}

describe('settings concurrency route', () => {
  it('returns rendering metadata after partial updates', async () => {
    const app = makeApp();

    const res = await app.inject({
      method: 'PUT',
      url: '/settings/concurrency',
      payload: { perCli: { 'opencode-cli': 1 } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      data: {
        maxParallelCli: 3,
        perCli: { 'opencode-cli': 1 },
        cliLineages: expect.arrayContaining(['opencode-cli']),
        defaults: {
          maxParallelCli: 3,
          perCli: expect.objectContaining({ 'opencode-cli': 2 }),
        },
      },
    });

    await app.close();
  });
});
