import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { describe, expect, it } from 'vitest';
import { resolveCodeReviewScope, getCodeReviewContextData } from '../src/lib/git-code-review-scope';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-review-scope-'));
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test User']);
  fs.writeFileSync(path.join(dir, 'app.ts'), 'export const value = 1;\n');
  git(dir, ['add', 'app.ts']);
  git(dir, ['commit', '-m', 'init']);
  return dir;
}

describe('resolveCodeReviewScope', () => {
  it('reviews staged, unstaged, deleted, and untracked worktree changes before branch diff', async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'app.ts'), 'export const value = 2;\n');
    fs.writeFileSync(path.join(repo, 'staged.ts'), 'export const staged = true;\n');
    fs.writeFileSync(path.join(repo, 'deleted.ts'), 'export const deleted = true;\n');
    git(repo, ['add', 'staged.ts', 'deleted.ts']);
    git(repo, ['commit', '-m', 'add staged and deleted fixtures']);
    fs.writeFileSync(path.join(repo, 'staged.ts'), 'export const staged = false;\n');
    git(repo, ['add', 'staged.ts']);
    fs.rmSync(path.join(repo, 'deleted.ts'));
    fs.writeFileSync(path.join(repo, 'new-file.ts'), 'export const added = true;\n');

    const scope = await resolveCodeReviewScope(repo);

    expect(scope.mode).toBe('worktree');
    expect(scope.files).toEqual(['app.ts', 'deleted.ts', 'new-file.ts', 'staged.ts']);
    expect(scope.artifact).toContain('# Code Review: worktree changes');
    expect(scope.artifact).toContain('diff --git a/app.ts b/app.ts');
    expect(scope.artifact).toContain('diff --git a/deleted.ts b/deleted.ts');
    expect(scope.artifact).toContain('diff --git a/new-file.ts b/new-file.ts');
    expect(scope.artifact).toContain('diff --git a/staged.ts b/staged.ts');
    expect(scope.baseRef).toBeUndefined();
  });

  it('reviews current clean branch against main', async () => {
    const repo = makeRepo();
    git(repo, ['checkout', '-b', 'feature/review-me']);
    fs.writeFileSync(path.join(repo, 'app.ts'), 'export const value = 3;\n');
    git(repo, ['add', 'app.ts']);
    git(repo, ['commit', '-m', 'change app']);

    const scope = await resolveCodeReviewScope(repo);

    expect(scope.mode).toBe('branch');
    expect(scope.baseRef).toBe('main');
    expect(scope.headRef).toBe('feature/review-me');
    expect(scope.files).toEqual(['app.ts']);
    expect(scope.artifact).toContain('# Code Review: feature/review-me against main');
    expect(scope.artifact).toContain('diff --git a/app.ts b/app.ts');
  });

  it('throws a clear error when there are no worktree or branch changes', async () => {
    const repo = makeRepo();

    await expect(resolveCodeReviewScope(repo)).rejects.toMatchObject({
      code: 'no_changes',
    });
  });

  it('falls back to origin/main when local main is unavailable', async () => {
    const remote = makeRepo();
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-review-clone-'));
    git(repo, ['clone', remote, '.']);
    git(repo, ['config', 'user.email', 'test@example.com']);
    git(repo, ['config', 'user.name', 'Test User']);
    git(repo, ['checkout', '-b', 'feature/from-origin']);
    fs.writeFileSync(path.join(repo, 'app.ts'), 'export const value = 4;\n');
    git(repo, ['add', 'app.ts']);
    git(repo, ['commit', '-m', 'feature change']);
    git(repo, ['branch', '-D', 'main']);

    const scope = await resolveCodeReviewScope(repo);

    expect(scope.mode).toBe('branch');
    expect(scope.baseRef).toBe('origin/main');
  });
});

describe('getCodeReviewContextData', () => {
  it('returns repository info and statistics for worktree changes', async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'app.ts'), 'export const value = 2;\n// extra line\n');
    fs.writeFileSync(path.join(repo, 'new-file.ts'), 'hello\nworld\n');

    const data = await getCodeReviewContextData(repo);
    expect(data.error).toBeUndefined();
    expect(data.mode).toBe('worktree');
    expect(data.filesCount).toBe(2);
    expect(data.insertions).toBe(4);
    expect(data.deletions).toBe(1);
  });

  it('returns repository info and statistics for branch changes', async () => {
    const repo = makeRepo();
    git(repo, ['checkout', '-b', 'feature/review-me']);
    fs.writeFileSync(path.join(repo, 'app.ts'), 'export const value = 3;\n// line 2\n// line 3\n');
    git(repo, ['add', 'app.ts']);
    git(repo, ['commit', '-m', 'change app']);

    const data = await getCodeReviewContextData(repo);
    expect(data.error).toBeUndefined();
    expect(data.mode).toBe('branch');
    expect(data.baseRef).toBe('main');
    expect(data.headRef).toBe('feature/review-me');
    expect(data.filesCount).toBe(1);
    expect(data.insertions).toBeGreaterThanOrEqual(2);
  });

  it('returns error when not a git repository', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chorus-not-git-'));
    const data = await getCodeReviewContextData(dir);
    expect(data.error).toBeDefined();
    expect(data.error?.message).toContain('not a git repository');
  });
});
