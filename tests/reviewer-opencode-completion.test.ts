import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StandardPhase } from '../src/lib/template-schema';
import type { RunnerEvent } from '../src/daemon/runner';
import type { AgentEvent, AgentShim } from '../src/daemon/agents/types';

const acquireState = vi.hoisted(() => ({
  acquired: false,
  released: false,
}));

const fakeShimState = vi.hoisted(() => ({
  calls: [] as { slotAcquiredAtStart: boolean }[],
}));

vi.mock('../src/lib/cli-precheck', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    precheckLineage: vi.fn(async () => ({ ok: true })),
  };
});

vi.mock('../src/lib/settings/transport', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getTransport: vi.fn(async () => 'headless'),
  };
});

vi.mock('../src/daemon/cli-semaphore', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    acquire: vi.fn(async () => {
      acquireState.acquired = true;
      return () => {
        acquireState.released = true;
      };
    }),
  };
});

vi.mock('../src/daemon/agents/index', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const fakeShim: AgentShim = {
    lineage: 'opencode',
    name: 'opencode-cli',
    buildLaunchCommand: () => 'opencode',
    formatPrompt: () => 'fake prompt',
    estimateCostUsd: () => 0,
    async *runHeadless(): AsyncIterable<AgentEvent> {
      fakeShimState.calls.push({ slotAcquiredAtStart: acquireState.acquired });
      yield { type: 'text_delta', text: 'Approved.\n' };
      yield { type: 'message_done', finalText: 'Approved.\n## DONE' };
    },
  };
  return {
    ...actual,
    pickShimForVoice: vi.fn(() => fakeShim),
    isHttpDispatchedShim: vi.fn(() => false),
  };
});

let tmp: string;
let chatDir: string;
let events: RunnerEvent[];
let dbPath: string;

beforeEach(async () => {
  dbPath = path.join(os.tmpdir(), `chorus-rev-opencode-${randomUUID()}.db`);
  process.env.CHORUS_DB_PATH = dbPath;
  const conn = await import('../src/lib/db/connection');
  await conn._resetDbForTests();

  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-opencode-'));
  chatDir = tmp;
  events = [];
  acquireState.acquired = false;
  acquireState.released = false;
  fakeShimState.calls = [];
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.CHORUS_DB_PATH;
  vi.restoreAllMocks();
});

const phase: StandardPhase = {
  id: 'review',
  kind: 'review',
  title: 'Code Review',
  description: '',
  doer: { lineage: 'anthropic', models: ['claude-opus-4-7'] },
  reviewer: {
    require: 1,
    crossLineage: false,
    candidates: [{ lineage: 'opencode', models: ['opencode-go/deepseek-v4-pro'] }],
  },
  inputs: { include: [], exclude: [] },
  iterate: {
    maxRounds: 1,
    onDisagreement: 'continue',
    shareSessionAcrossRounds: false,
    shareSessionAcrossPhases: false,
  },
} as unknown as StandardPhase;

describe('OpenCode reviewer completion helpers', () => {
  it('matches only OpenCode terminal DONE output with Build usage footer', async () => {
    const { openCodePaneShowsDone } = await import('../src/daemon/runner/reviewer-driver');

    expect(openCodePaneShowsDone('\nDONE\nBuild · DeepSeek V4 Flash')).toBe(true);
    expect(openCodePaneShowsDone('\nDONE\nplain model answer')).toBe(false);
    expect(openCodePaneShowsDone('Build · DeepSeek V4 Flash')).toBe(false);
  });

  it('appends DONE sentinel once', async () => {
    const { ensureDoneSentinel } = await import('../src/daemon/runner/reviewer-driver');
    const answerFile = path.join(tmp, 'answer.md');

    ensureDoneSentinel(answerFile, 'final answer');
    expect(fs.readFileSync(answerFile, 'utf-8')).toBe('final answer\n\n## DONE\n');

    ensureDoneSentinel(answerFile, fs.readFileSync(answerFile, 'utf-8'));
    expect(fs.readFileSync(answerFile, 'utf-8')).toBe('final answer\n\n## DONE\n');
  });
});

describe('runSingleReviewerWithPrompt — success ordering', () => {
  it('emits phase_start after the reviewer slot is acquired', async () => {
    const { runSingleReviewerWithPrompt } = await import('../src/daemon/runner/reviewer-driver');
    type RunSingleArgs = Parameters<typeof runSingleReviewerWithPrompt>[0];
    const fakeTmux = {} as RunSingleArgs['tmuxMgr'];
    const fakeErrorDetector = {} as RunSingleArgs['errorDetector'];

    const result = await runSingleReviewerWithPrompt({
      chatDir,
      chatId: 'test-chat',
      phase,
      phaseIdx: 0,
      round: 1,
      reviewerIdx: 0,
      askContent: 'review this',
      tmuxMgr: fakeTmux,
      errorDetector: fakeErrorDetector,
      onEvent: (e) => events.push(e),
      abortSignal: new AbortController().signal,
    });

    expect(result.result).toBe(true);
    expect(fakeShimState.calls).toEqual([{ slotAcquiredAtStart: true }]);
    expect(acquireState.released).toBe(true);

    const phaseStart = events.find((e) => e.type === 'phase_start');
    expect(phaseStart).toMatchObject({
      payload: {
        role: 'reviewer',
        agent: 'opencode-cli-0',
      },
    });
    expect(events.findIndex((e) => e.type === 'phase_start')).toBeLessThan(
      events.findIndex((e) => e.type === 'phase_done'),
    );
  });
});
