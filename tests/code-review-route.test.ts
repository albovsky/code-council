import Fastify from 'fastify';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetDbForTests, templates, voices } from '../src/lib/db/index';

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

let dbPath: string;

beforeEach(async () => {
  dbPath = path.join(os.tmpdir(), `chorus-code-review-route-${Date.now()}-${Math.random()}.db`);
  process.env.CHORUS_DB_PATH = dbPath;
  await _resetDbForTests();
  await templates.create('branch-code-review', TEMPLATE_YAML, 'builtin', true);
  gitScopeMock.resolveCodeReviewScope.mockReset();
});

afterEach(async () => {
  await _resetDbForTests();
  delete process.env.CHORUS_DB_PATH;
  fs.rmSync(dbPath, { force: true });
});

describe('registerCodeReviewRoutes', () => {
  it('creates a branch-code-review chat from resolved git scope', async () => {
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
