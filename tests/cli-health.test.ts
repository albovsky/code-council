import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getAllHealth, recordHealth } from '@/lib/cli-health';
import { chats } from '@/lib/db/chats';
import { _resetDbForTests } from '@/lib/db/connection';
import { phaseEvents } from '@/lib/db/phase-events';

let dbPath: string;

beforeEach(async () => {
  dbPath = path.join(os.tmpdir(), `chorus-cli-health-${randomUUID()}.db`);
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

describe('getAllHealth', () => {
  it('derives healthy status from historical submitted reviewer events', async () => {
    const submittedAt = Date.now();
    const chat = await chats.create({ work: 'review this', template_id: 'test-template' });
    await phaseEvents.create({
      chat_id: chat.id,
      phase_idx: 0,
      phase_kind: 'review',
      role: 'reviewer',
      agent_id: 'codex-cli-0',
      state: 'submitted',
      output: null,
      cost_usd: 0,
      tokens_in: 0,
      tokens_out: 0,
      started_at: submittedAt - 10,
      finished_at: submittedAt,
    });

    const healths = await getAllHealth();

    expect(healths.find((health) => health.lineage === 'openai')).toMatchObject({
      lineage: 'openai',
      status: 'healthy',
      updatedAt: submittedAt,
    });
  });

  it('keeps newer explicit health over older submitted events', async () => {
    const submittedAt = Date.now() - 10_000;
    const chat = await chats.create({ work: 'review this', template_id: 'test-template' });
    await phaseEvents.create({
      chat_id: chat.id,
      phase_idx: 0,
      phase_kind: 'review',
      role: 'reviewer',
      agent_id: 'codex-cli-0',
      state: 'submitted',
      output: null,
      cost_usd: 0,
      tokens_in: 0,
      tokens_out: 0,
      started_at: submittedAt - 10,
      finished_at: submittedAt,
    });
    await recordHealth({
      lineage: 'openai',
      status: 'quota_exhausted',
      message: 'out of quota',
      resetAt: Date.now() + 60_000,
    });

    const healths = await getAllHealth();

    expect(healths.find((health) => health.lineage === 'openai')).toMatchObject({
      lineage: 'openai',
      status: 'quota_exhausted',
      message: 'out of quota',
    });
  });
});
