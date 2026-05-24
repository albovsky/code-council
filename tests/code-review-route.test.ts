import Fastify from 'fastify';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetDbForTests, chats, settings, templates, voices } from '../src/lib/db/index';
import type { runThermoCodeReview } from '../src/daemon/runner/thermo-code-review';

type ThermoRunnerArgs = Parameters<typeof runThermoCodeReview>[0];
type ThermoRunnerResult = Awaited<ReturnType<typeof runThermoCodeReview>>;

const gitScopeMock = vi.hoisted(() => {
  class CodeReviewScopeError extends Error {
    constructor(
      readonly code:
        | 'not_git_repo'
        | 'no_changes'
        | 'base_ref_missing'
        | 'artifact_too_large'
        | 'git_failed',
      message: string,
    ) {
      super(message);
      this.name = 'CodeReviewScopeError';
    }
  }
  return {
    CodeReviewScopeError,
    resolveCodeReviewScope: vi.fn(),
  };
});

vi.mock('../src/lib/git-code-review-scope.js', () => gitScopeMock);

const thermoRunnerMock = vi.hoisted(() => ({
  runThermoCodeReview: vi.fn((_args: ThermoRunnerArgs): Promise<ThermoRunnerResult> => Promise.resolve({
    completed: true,
    verdict: 'approved',
    phaseOneOutputs: [],
    validationNotes: [],
    skippedAgents: [],
    coverageGaps: [],
  })),
}));

vi.mock('../src/daemon/runner/thermo-code-review.js', () => thermoRunnerMock);

const TEMPLATE_YAML = `id: branch-code-review
name: Code Review
description: Review current git changes.
phases:
  - id: review
    kind: review_only
    title: Code Review
    reviewer:
      require: 1
      crossLineage: false
      candidates:
        - lineage: openai
          models: [gpt-5.5]
    artifact:
      maxBytes: 1048576
`;

type ThermoRunnerCall = [{
  assignments: {
    skippedVoiceIds: string[];
    assignments: {
      final_synthesis: {
        primary?: {
          voice: {
            model_id: string;
          };
        };
      };
    };
  };
}];

let dbPath: string;

beforeEach(async () => {
  dbPath = path.join(os.tmpdir(), `chorus-code-review-route-${Date.now()}-${Math.random()}.db`);
  process.env.CHORUS_DB_PATH = dbPath;
  await _resetDbForTests();
  await templates.create('branch-code-review', TEMPLATE_YAML, 'builtin', true);
  gitScopeMock.resolveCodeReviewScope.mockReset();
  thermoRunnerMock.runThermoCodeReview.mockClear();
});

afterEach(async () => {
  await _resetDbForTests();
  delete process.env.CHORUS_DB_PATH;
  fs.rmSync(dbPath, { force: true });
});

describe('registerCodeReviewRoutes', () => {
  it('defaults missing mode to fast and creates a branch-code-review chat from resolved git scope', async () => {
    const { registerCodeReviewRoutes } = await import('../src/daemon/routes/code-review');
    gitScopeMock.resolveCodeReviewScope.mockResolvedValue({
      repoPath: '/repo',
      repoRoot: '/repo',
      mode: 'worktree',
      headRef: 'feature/current',
      files: ['app.ts'],
      artifact: '# Code Review: worktree changes\n\ndiff --git a/app.ts b/app.ts\n',
      title: 'Review worktree changes in repo',
      totalBytes: 92,
    });

    const app = Fastify({ logger: false });
    registerCodeReviewRoutes(app, { startRun: false });
    const res = await app.inject({
      method: 'POST',
      url: '/code-review',
      payload: { repoPath: '/repo' },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.template_id).toBe('branch-code-review');
    expect(body.data.artifact).toContain('diff --git a/app.ts b/app.ts');
    expect(body.data.codeReview).toMatchObject({
      mode: 'worktree',
      repoRoot: '/repo',
      headRef: 'feature/current',
      files: ['app.ts'],
    });
    expect(gitScopeMock.resolveCodeReviewScope).toHaveBeenCalledWith('/repo', {
      maxBytes: 1048576,
    });
  });

  it('uses fast behavior when mode is explicit fast', async () => {
    const { registerCodeReviewRoutes } = await import('../src/daemon/routes/code-review');
    gitScopeMock.resolveCodeReviewScope.mockResolvedValue({
      repoPath: '/repo',
      repoRoot: '/repo',
      mode: 'worktree',
      headRef: 'feature/current',
      files: ['app.ts'],
      artifact: '# Code Review: worktree changes\n\ndiff --git a/app.ts b/app.ts\n',
      title: 'Review worktree changes in repo',
      totalBytes: 92,
    });

    const app = Fastify({ logger: false });
    registerCodeReviewRoutes(app, { startRun: false });
    const res = await app.inject({
      method: 'POST',
      url: '/code-review',
      payload: { repoPath: '/repo', mode: 'fast' },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.template_id).toBe('branch-code-review');
    expect(body.data.work).toContain('Review this git diff');
    expect(thermoRunnerMock.runThermoCodeReview).not.toHaveBeenCalled();
    expect(gitScopeMock.resolveCodeReviewScope).toHaveBeenCalledWith('/repo', {
      maxBytes: 1048576,
    });
  });

  it('rejects invalid mode with a validation error', async () => {
    const { registerCodeReviewRoutes } = await import('../src/daemon/routes/code-review');

    const app = Fastify({ logger: false });
    registerCodeReviewRoutes(app, { startRun: false });
    const res = await app.inject({
      method: 'POST',
      url: '/code-review',
      payload: { repoPath: '/repo', mode: 'slow' },
    });
    await app.close();

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
    expect(gitScopeMock.resolveCodeReviewScope).not.toHaveBeenCalled();
  });

  it('creates a thermo chat without mutating the branch-code-review template', async () => {
    const { registerCodeReviewRoutes } = await import('../src/daemon/routes/code-review');
    await voices.upsert({
      id: 'codex-cli',
      label: 'Codex',
      source: 'cli',
      provider: 'codex-cli',
      model_id: 'gpt-5.5',
      lineage: 'openai',
      enabled: true,
    });
    await voices.upsert({
      id: 'opencode-deepseek',
      label: 'DeepSeek via OpenCode',
      source: 'cli',
      provider: 'opencode-cli',
      model_id: 'opencode-go/deepseek-v4-pro',
      lineage: 'opencode',
      enabled: true,
    });
    gitScopeMock.resolveCodeReviewScope.mockResolvedValue({
      repoPath: '/repo',
      repoRoot: '/repo',
      mode: 'worktree',
      headRef: 'feature/current',
      files: ['app.ts'],
      artifact: '# Code Review: worktree changes\n\ndiff --git a/app.ts b/app.ts\n',
      title: 'Review worktree changes in repo',
      totalBytes: 92,
    });
    const beforeTemplate = await templates.getById('branch-code-review');

    const app = Fastify({ logger: false });
    registerCodeReviewRoutes(app, { startRun: false });
    const res = await app.inject({
      method: 'POST',
      url: '/code-review',
      payload: { repoPath: '/repo', mode: 'thermo' },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.template_id).toBe('branch-code-review-thermo');
    expect(await templates.getById('branch-code-review-thermo')).not.toBeNull();
    expect(body.data.artifact).toContain('diff --git a/app.ts b/app.ts');
    expect(body.data.work).toContain('Thermo review this git diff');
    expect(body.data.codeReview).toMatchObject({
      mode: 'worktree',
      repoRoot: '/repo',
      headRef: 'feature/current',
      files: ['app.ts'],
    });
    expect(thermoRunnerMock.runThermoCodeReview).not.toHaveBeenCalled();
    expect(gitScopeMock.resolveCodeReviewScope).toHaveBeenCalledWith('/repo', {
      maxBytes: 1048576,
    });
    const afterTemplate = await templates.getById('branch-code-review');
    expect(afterTemplate?.yaml).toBe(beforeTemplate?.yaml);
  });

  it('uses the branch-code-review template artifact maxBytes for thermo scope resolution', async () => {
    const { registerCodeReviewRoutes } = await import('../src/daemon/routes/code-review');
    await templates.create(
      'branch-code-review',
      TEMPLATE_YAML.replace('maxBytes: 1048576', 'maxBytes: 32768'),
      'builtin',
      true,
    );
    gitScopeMock.resolveCodeReviewScope.mockResolvedValue({
      repoPath: '/repo',
      repoRoot: '/repo',
      mode: 'worktree',
      headRef: 'feature/current',
      files: ['app.ts'],
      artifact: '# Code Review: worktree changes\n\ndiff --git a/app.ts b/app.ts\n',
      title: 'Review worktree changes in repo',
      totalBytes: 92,
    });

    const app = Fastify({ logger: false });
    registerCodeReviewRoutes(app, { startRun: false });
    const res = await app.inject({
      method: 'POST',
      url: '/code-review',
      payload: { repoPath: '/repo', mode: 'thermo' },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(gitScopeMock.resolveCodeReviewScope).toHaveBeenCalledWith('/repo', {
      maxBytes: 32768,
    });
  });

  it('computes thermo assignments from currently enabled voices at launch', async () => {
    const { registerCodeReviewRoutes } = await import('../src/daemon/routes/code-review');
    await voices.upsert({
      id: 'codex-cli',
      label: 'Codex',
      source: 'cli',
      provider: 'codex-cli',
      model_id: 'gpt-5.5',
      lineage: 'openai',
      enabled: true,
    });
    await voices.upsert({
      id: 'opencode-deepseek',
      label: 'DeepSeek via OpenCode',
      source: 'cli',
      provider: 'opencode-cli',
      model_id: 'opencode-go/deepseek-v4-pro',
      lineage: 'opencode',
      enabled: false,
    });
    gitScopeMock.resolveCodeReviewScope.mockResolvedValue({
      repoPath: '/repo',
      repoRoot: '/repo',
      mode: 'worktree',
      headRef: 'feature/current',
      files: ['app.ts'],
      artifact: '# Code Review: worktree changes\n\ndiff --git a/app.ts b/app.ts\n',
      title: 'Review worktree changes in repo',
      totalBytes: 92,
    });

    const app = Fastify({ logger: false });
    registerCodeReviewRoutes(app, {
      startRun: true,
      tmuxMgr: {} as never,
      errorDetector: {} as never,
    });
    const first = await app.inject({
      method: 'POST',
      url: '/code-review',
      payload: { repoPath: '/repo', mode: 'thermo' },
    });
    expect(first.statusCode).toBe(200);
    const thermoCalls = thermoRunnerMock.runThermoCodeReview.mock.calls as unknown as ThermoRunnerCall[];
    expect(
      thermoCalls[0]?.[0].assignments.assignments.final_synthesis.primary?.voice.model_id,
    ).toBe('gpt-5.5');

    await voices.update('codex-cli', { enabled: false });
    await voices.update('opencode-deepseek', { enabled: true });

    const second = await app.inject({
      method: 'POST',
      url: '/code-review',
      payload: { repoPath: '/repo', mode: 'thermo' },
    });
    await app.close();

    expect(second.statusCode).toBe(200);
    expect(
      thermoCalls[1]?.[0].assignments.assignments.final_synthesis.primary?.voice.model_id,
    ).toBe('opencode-go/deepseek-v4-pro');
  });

  it('excludes skipped voices from thermo assignments at launch', async () => {
    const { registerCodeReviewRoutes } = await import('../src/daemon/routes/code-review');
    await voices.upsert({
      id: 'codex-cli',
      label: 'Codex',
      source: 'cli',
      provider: 'codex-cli',
      model_id: 'gpt-5.5',
      lineage: 'openai',
      enabled: true,
    });
    await voices.upsert({
      id: 'opencode-deepseek',
      label: 'DeepSeek via OpenCode',
      source: 'cli',
      provider: 'opencode-cli',
      model_id: 'opencode-go/deepseek-v4-pro',
      lineage: 'opencode',
      enabled: true,
    });
    gitScopeMock.resolveCodeReviewScope.mockResolvedValue({
      repoPath: '/repo',
      repoRoot: '/repo',
      mode: 'worktree',
      headRef: 'feature/current',
      files: ['app.ts'],
      artifact: '# Code Review: worktree changes\n\ndiff --git a/app.ts b/app.ts\n',
      title: 'Review worktree changes in repo',
      totalBytes: 92,
    });

    const app = Fastify({ logger: false });
    registerCodeReviewRoutes(app, {
      startRun: true,
      tmuxMgr: {} as never,
      errorDetector: {} as never,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/code-review',
      payload: {
        repoPath: '/repo',
        mode: 'thermo',
        skippedVoiceIds: ['codex-cli'],
      },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const thermoCalls = thermoRunnerMock.runThermoCodeReview.mock.calls as unknown as ThermoRunnerCall[];
    expect(thermoCalls.at(-1)?.[0].assignments.skippedVoiceIds).toEqual(['codex-cli']);
    expect(
      thermoCalls.at(-1)?.[0].assignments.assignments.final_synthesis.primary?.voice.model_id,
    ).toBe('opencode-go/deepseek-v4-pro');
  });

  it('registers thermo runs with the active-run lifecycle so cancellation can abort them', async () => {
    const { registerCodeReviewRoutes } = await import('../src/daemon/routes/code-review');
    const { getActiveRun } = await import('../src/daemon/runner-multiplex');
    let resolveRun: (() => void) | undefined;
    let capturedSignal: AbortSignal | undefined;
    thermoRunnerMock.runThermoCodeReview.mockImplementationOnce((args) => {
      capturedSignal = args.abortSignal;
      return new Promise((resolve) => {
        resolveRun = () => {
          args.onEvent({
            chatId: args.chatId,
            type: 'chat_done',
            payload: { status: 'completed', verdict: 'approved' },
            ts: Date.now(),
          });
          resolve({
            completed: true,
            verdict: 'approved',
            phaseOneOutputs: [],
            validationNotes: [],
            skippedAgents: [],
            coverageGaps: [],
          });
        };
      });
    });
    await voices.upsert({
      id: 'codex-cli',
      label: 'Codex',
      source: 'cli',
      provider: 'codex-cli',
      model_id: 'gpt-5.5',
      lineage: 'openai',
      enabled: true,
    });
    gitScopeMock.resolveCodeReviewScope.mockResolvedValue({
      repoPath: '/repo',
      repoRoot: '/repo',
      mode: 'worktree',
      headRef: 'feature/current',
      files: ['app.ts'],
      artifact: '# Code Review: worktree changes\n\ndiff --git a/app.ts b/app.ts\n',
      title: 'Review worktree changes in repo',
      totalBytes: 92,
    });

    const app = Fastify({ logger: false });
    registerCodeReviewRoutes(app, {
      startRun: true,
      tmuxMgr: {} as never,
      errorDetector: {} as never,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/code-review',
      payload: { repoPath: '/repo', mode: 'thermo' },
    });
    expect(res.statusCode).toBe(200);
    const chatId = res.json().data.id;
    const active = getActiveRun(chatId);
    expect(active).toBeDefined();

    active?.abortController.abort();
    expect(capturedSignal?.aborted).toBe(true);
    resolveRun?.();
    await active?.promise;
    const row = await chats.getById(chatId);
    expect(row?.status).toBe('cancelled');
    expect(row?.verdict).toBe('failed');
    expect(getActiveRun(chatId)).toBeUndefined();
    await app.close();
  });

  it('keeps orphaned thermo chats viewable without marking them failed', async () => {
    const { registerCodeReviewRoutes } = await import('../src/daemon/routes/code-review');
    const { registerChatStreamRoute } = await import('../src/daemon/routes/chats-stream');
    await voices.upsert({
      id: 'codex-cli',
      label: 'Codex',
      source: 'cli',
      provider: 'codex-cli',
      model_id: 'gpt-5.5',
      lineage: 'openai',
      enabled: true,
    });
    gitScopeMock.resolveCodeReviewScope.mockResolvedValue({
      repoPath: '/repo',
      repoRoot: '/repo',
      mode: 'worktree',
      headRef: 'feature/current',
      files: ['app.ts'],
      artifact: '# Code Review: worktree changes\n\ndiff --git a/app.ts b/app.ts\n',
      title: 'Review worktree changes in repo',
      totalBytes: 92,
    });

    const app = Fastify({ logger: false });
    registerCodeReviewRoutes(app, { startRun: false });
    registerChatStreamRoute(app, {
      tmuxMgr: {} as never,
      errorDetector: {} as never,
    });
    const created = await app.inject({
      method: 'POST',
      url: '/code-review',
      payload: { repoPath: '/repo', mode: 'thermo' },
    });
    expect(created.statusCode).toBe(200);
    const chatId = created.json().data.id;
    const before = await chats.getById(chatId);

    const stream = await app.inject({
      method: 'GET',
      url: `/chats/${chatId}/stream`,
    });
    await app.close();

    expect(stream.statusCode).toBe(200);
    expect(stream.body).toContain('thermo_runner_unavailable');
    expect(stream.body).toContain('non_resumable');
    const row = await chats.getById(chatId);
    expect(row?.status).toBe(before?.status);
    expect(row?.verdict).toBe(before?.verdict);
    expect(row?.finished_at).toBe(before?.finished_at);
    expect(thermoRunnerMock.runThermoCodeReview).not.toHaveBeenCalled();
  });

  it('marks thermo chats failed when the runner rejects before chat_done', async () => {
    const { registerCodeReviewRoutes } = await import('../src/daemon/routes/code-review');
    const { getActiveRun } = await import('../src/daemon/runner-multiplex');
    thermoRunnerMock.runThermoCodeReview.mockRejectedValueOnce(new Error('thermo crashed'));
    await voices.upsert({
      id: 'codex-cli',
      label: 'Codex',
      source: 'cli',
      provider: 'codex-cli',
      model_id: 'gpt-5.5',
      lineage: 'openai',
      enabled: true,
    });
    gitScopeMock.resolveCodeReviewScope.mockResolvedValue({
      repoPath: '/repo',
      repoRoot: '/repo',
      mode: 'worktree',
      headRef: 'feature/current',
      files: ['app.ts'],
      artifact: '# Code Review: worktree changes\n\ndiff --git a/app.ts b/app.ts\n',
      title: 'Review worktree changes in repo',
      totalBytes: 92,
    });

    const app = Fastify({ logger: false });
    registerCodeReviewRoutes(app, {
      startRun: true,
      tmuxMgr: {} as never,
      errorDetector: {} as never,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/code-review',
      payload: { repoPath: '/repo', mode: 'thermo' },
    });
    expect(res.statusCode).toBe(200);
    const chatId = res.json().data.id;
    const active = getActiveRun(chatId);
    await active?.promise;
    const row = await chats.getById(chatId);
    expect(row?.status).toBe('failed');
    expect(row?.verdict).toBe('failed');
    await app.close();
  });

  it('returns validation error when the repo has no changes', async () => {
    const { registerCodeReviewRoutes } = await import('../src/daemon/routes/code-review');
    gitScopeMock.resolveCodeReviewScope.mockRejectedValue(
      new gitScopeMock.CodeReviewScopeError('no_changes', 'No reviewable changes.'),
    );

    const app = Fastify({ logger: false });
    registerCodeReviewRoutes(app, { startRun: false });
    const res = await app.inject({
      method: 'POST',
      url: '/code-review',
      payload: { repoPath: '/repo' },
    });
    await app.close();

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      ok: false,
      error: { code: 'no_changes', message: 'No reviewable changes.' },
    });
  });

  it('uses saved code-review disabled voices when launch payload omits skipped voices', async () => {
    const { registerCodeReviewRoutes } = await import('../src/daemon/routes/code-review');
    await voices.upsert({
      id: 'codex-cli',
      label: 'Codex',
      source: 'cli',
      provider: 'codex-cli',
      model_id: 'gpt-5.5',
      lineage: 'openai',
      enabled: true,
    });
    await settings.set('code_review.disabled_voice_ids', ['codex-cli']);
    gitScopeMock.resolveCodeReviewScope.mockResolvedValue({
      repoPath: '/repo',
      repoRoot: '/repo',
      mode: 'worktree',
      headRef: 'feature/current',
      files: ['app.ts'],
      artifact: '# Code Review: worktree changes\n\ndiff --git a/app.ts b/app.ts\n',
      title: 'Review worktree changes in repo',
      totalBytes: 92,
    });

    const app = Fastify({ logger: false });
    registerCodeReviewRoutes(app, { startRun: false });
    const res = await app.inject({
      method: 'POST',
      url: '/code-review',
      payload: { repoPath: '/repo' },
    });
    await app.close();

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      ok: false,
      error: {
        code: 'validation',
        message: 'At least one reviewer must remain active for code review.',
      },
    });
  });

  it('persists the effective fast-review template when voices are skipped', async () => {
    const { registerCodeReviewRoutes } = await import('../src/daemon/routes/code-review');
    await voices.upsert({
      id: 'codex-cli',
      label: 'Codex',
      source: 'cli',
      provider: 'codex-cli',
      model_id: 'gpt-5.5',
      lineage: 'openai',
      enabled: true,
    });
    await voices.upsert({
      id: 'antigravity-cli',
      label: 'Antigravity',
      source: 'cli',
      provider: 'antigravity-cli',
      model_id: 'gemini-3.5-flash',
      lineage: 'google',
      enabled: true,
    });
    gitScopeMock.resolveCodeReviewScope.mockResolvedValue({
      repoPath: '/repo',
      repoRoot: '/repo',
      mode: 'worktree',
      headRef: 'feature/current',
      files: ['app.ts'],
      artifact: '# Code Review: worktree changes\n\ndiff --git a/app.ts b/app.ts\n',
      title: 'Review worktree changes in repo',
      totalBytes: 92,
    });

    const app = Fastify({ logger: false });
    registerCodeReviewRoutes(app, { startRun: false });
    const res = await app.inject({
      method: 'POST',
      url: '/code-review',
      payload: { repoPath: '/repo', skippedVoiceIds: ['codex-cli'] },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const row = await chats.getById(res.json().data.id);
    expect(row?.template_snapshot).toBeTruthy();
    const snapshot = JSON.parse(row?.template_snapshot ?? '{}');
    const models = snapshot.phases?.[0]?.reviewer?.candidates?.flatMap(
      (candidate: { models?: string[] }) => candidate.models ?? [],
    );
    expect(models).toContain('gemini-3.5-flash');
    expect(models).not.toContain('gpt-5.5');
  });

  it('refreshes the builtin code-review template from currently enabled voices at launch', async () => {
    const { registerCodeReviewRoutes } = await import('../src/daemon/routes/code-review');
    await voices.upsert({
      id: 'codex-cli',
      label: 'Codex',
      source: 'cli',
      provider: 'codex-cli',
      model_id: 'gpt-5.5',
      lineage: 'openai',
      enabled: true,
    });
    await voices.upsert({
      id: 'antigravity-cli',
      label: 'Antigravity',
      source: 'cli',
      provider: 'antigravity-cli',
      model_id: 'gemini-3.5-flash',
      lineage: 'google',
      enabled: true,
    });
    await voices.upsert({
      id: 'opencode-kimi',
      label: 'Kimi via OpenCode',
      source: 'cli',
      provider: 'opencode-cli',
      model_id: 'opencode-go/kimi-k2.6',
      lineage: 'opencode',
      vendor_family: 'moonshot',
      enabled: true,
    });
    await voices.upsert({
      id: 'opencode-deepseek',
      label: 'DeepSeek via OpenCode',
      source: 'cli',
      provider: 'opencode-cli',
      model_id: 'opencode-go/deepseek-v4-pro',
      lineage: 'opencode',
      enabled: true,
    });
    await voices.upsert({
      id: 'opencode-qwen',
      label: 'Qwen via OpenCode',
      source: 'cli',
      provider: 'opencode-cli',
      model_id: 'opencode-go/qwen3.6-plus',
      lineage: 'opencode',
      enabled: true,
    });

    gitScopeMock.resolveCodeReviewScope.mockResolvedValue({
      repoPath: '/repo',
      repoRoot: '/repo',
      mode: 'worktree',
      headRef: 'feature/current',
      files: ['app.ts'],
      artifact: '# Code Review: worktree changes\n\ndiff --git a/app.ts b/app.ts\n',
      title: 'Review worktree changes in repo',
      totalBytes: 92,
    });

    const app = Fastify({ logger: false });
    registerCodeReviewRoutes(app, { startRun: false });
    const res = await app.inject({
      method: 'POST',
      url: '/code-review',
      payload: { repoPath: '/repo' },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const refreshed = await templates.getById('branch-code-review');
    expect(refreshed?.yaml).toContain('opencode-go/kimi-k2.6');
    expect(refreshed?.yaml).toContain('opencode-go/deepseek-v4-pro');
    expect(refreshed?.yaml).toContain('opencode-go/qwen3.6-plus');
  });
});
