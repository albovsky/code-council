import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export type CodeReviewScopeMode = 'worktree' | 'branch';

export interface CodeReviewScope {
  repoPath: string;
  repoRoot: string;
  mode: CodeReviewScopeMode;
  baseRef?: string;
  headRef: string;
  files: string[];
  artifact: string;
  title: string;
  totalBytes: number;
}

export type CodeReviewScopeErrorCode =
  | 'not_git_repo'
  | 'no_changes'
  | 'base_ref_missing'
  | 'artifact_too_large'
  | 'git_failed';

export class CodeReviewScopeError extends Error {
  constructor(
    readonly code: CodeReviewScopeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CodeReviewScopeError';
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf-8',
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout.trimEnd();
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; code?: number };
    if (args[0] === 'diff' && args.includes('--no-index') && e.code === 1) {
      return (e.stdout ?? '').trimEnd();
    }
    throw new CodeReviewScopeError(
      'git_failed',
      e.stderr?.trim() || `git ${args.join(' ')} failed`,
    );
  }
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean))).sort(
    (a, b) => a.localeCompare(b),
  );
}

async function changedWorktreeFiles(repoRoot: string): Promise<string[]> {
  const tracked = await git(repoRoot, ['diff', '--name-only', 'HEAD', '--']);
  const untracked = await git(repoRoot, [
    'ls-files',
    '--others',
    '--exclude-standard',
  ]);
  return uniqueSorted([...tracked.split('\n'), ...untracked.split('\n')]);
}

async function trackedFiles(repoRoot: string): Promise<Set<string>> {
  const names = await git(repoRoot, ['ls-files']);
  return new Set(names.split('\n').filter(Boolean));
}

async function resolveBaseRef(repoRoot: string): Promise<string> {
  for (const ref of ['main', 'origin/main', 'master', 'origin/master']) {
    try {
      await git(repoRoot, ['rev-parse', '--verify', `${ref}^{commit}`]);
      return ref;
    } catch {
      // try the next conventional base ref
    }
  }
  throw new CodeReviewScopeError(
    'base_ref_missing',
    'Could not find main, origin/main, master, or origin/master for branch comparison.',
  );
}

function nullDiffPath(): string {
  return process.platform === 'win32' ? 'NUL' : '/dev/null';
}

async function untrackedDiff(repoRoot: string, file: string): Promise<string> {
  const diff = await git(repoRoot, [
    'diff',
    '--no-index',
    '--',
    nullDiffPath(),
    file,
  ]);
  if (!diff.trim()) return '';

  const lines = diff.split('\n');
  if (lines[0]?.startsWith('diff --git ')) {
    lines[0] = `diff --git a/${file} b/${file}`;
  }
  return lines.join('\n');
}

async function untrackedNumstat(repoRoot: string, file: string): Promise<string> {
  return git(repoRoot, [
    'diff',
    '--numstat',
    '--no-index',
    '--',
    nullDiffPath(),
    file,
  ]);
}

async function worktreeNumstat(repoRoot: string, files: string[]): Promise<string> {
  const trackedStats = await git(repoRoot, ['diff', '--numstat', 'HEAD', '--']);
  const tracked = await trackedFiles(repoRoot);
  const untracked = files.filter((file) => !tracked.has(file));
  const untrackedStats = await Promise.all(
    untracked.map((file) => untrackedNumstat(repoRoot, file)),
  );
  return [trackedStats, ...untrackedStats].filter(Boolean).join('\n');
}

function parseNumstatTotals(statsStdout: string): {
  insertions: number;
  deletions: number;
} {
  let insertions = 0;
  let deletions = 0;

  for (const line of statsStdout.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2) {
      const ins = parseInt(parts[0], 10);
      const del = parseInt(parts[1], 10);
      if (!isNaN(ins)) insertions += ins;
      if (!isNaN(del)) deletions += del;
    }
  }

  return { insertions, deletions };
}

function buildHeading(args: {
  mode: CodeReviewScopeMode;
  repoRoot: string;
  headRef: string;
  baseRef?: string;
  files: string[];
}): string {
  const title =
    args.mode === 'worktree'
      ? 'Code Review: worktree changes'
      : `Code Review: ${args.headRef} against ${args.baseRef}`;
  return [
    `# ${title}`,
    '',
    `Repository: \`${args.repoRoot}\``,
    `Mode: \`${args.mode}\``,
    `Branch: \`${args.headRef}\``,
    args.baseRef ? `Base: \`${args.baseRef}\`` : undefined,
    '',
    `Changed files (${args.files.length}):`,
    ...args.files.map((file) => `- \`${file}\``),
    '',
    '---',
    '',
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n');
}

export async function resolveCodeReviewScope(
  repoPath: string,
  options: { maxBytes?: number } = {},
): Promise<CodeReviewScope> {
  const resolved = path.resolve(repoPath);
  let repoRoot: string;
  try {
    repoRoot = await git(resolved, ['rev-parse', '--show-toplevel']);
  } catch {
    throw new CodeReviewScopeError(
      'not_git_repo',
      `${resolved} is not a git repository.`,
    );
  }

  const headRef =
    (await git(repoRoot, ['branch', '--show-current'])) ||
    (await git(repoRoot, ['rev-parse', '--short', 'HEAD']));
  const worktreeFiles = await changedWorktreeFiles(repoRoot);

  let mode: CodeReviewScopeMode;
  let baseRef: string | undefined;
  let files: string[];
  let diff: string;

  if (worktreeFiles.length > 0) {
    mode = 'worktree';
    files = worktreeFiles;
    const trackedDiff = await git(repoRoot, [
      'diff',
      '--binary',
      '--no-ext-diff',
      'HEAD',
      '--',
    ]);
    const tracked = await trackedFiles(repoRoot);
    const untracked = files.filter((file) => !tracked.has(file));
    const untrackedBlocks = await Promise.all(
      untracked.map((file) => untrackedDiff(repoRoot, file)),
    );
    diff = [trackedDiff, ...untrackedBlocks].filter(Boolean).join('\n\n');
  } else {
    mode = 'branch';
    baseRef = await resolveBaseRef(repoRoot);
    const names = await git(repoRoot, [
      'diff',
      '--name-only',
      `${baseRef}...HEAD`,
      '--',
    ]);
    files = uniqueSorted(names.split('\n'));
    if (files.length === 0) {
      throw new CodeReviewScopeError(
        'no_changes',
        `No worktree changes and no branch changes against ${baseRef}.`,
      );
    }
    diff = await git(repoRoot, [
      'diff',
      '--binary',
      '--no-ext-diff',
      `${baseRef}...HEAD`,
      '--',
    ]);
  }

  if (!diff.trim()) {
    throw new CodeReviewScopeError('no_changes', 'No reviewable diff was produced.');
  }

  const artifact = `${buildHeading({ mode, repoRoot, headRef, baseRef, files })}${diff}\n`;
  const totalBytes = Buffer.byteLength(artifact, 'utf-8');
  const maxBytes = options.maxBytes ?? 1024 * 1024;
  if (totalBytes > maxBytes) {
    throw new CodeReviewScopeError(
      'artifact_too_large',
      `Code review diff is ${totalBytes} bytes; template limit is ${maxBytes} bytes. Split the branch or narrow the diff.`,
    );
  }

  return {
    repoPath: resolved,
    repoRoot,
    mode,
    baseRef,
    headRef,
    files,
    artifact,
    title:
      mode === 'worktree'
        ? `Review worktree changes in ${path.basename(repoRoot)}`
        : `Review ${headRef} against ${baseRef}`,
    totalBytes,
  };
}

export interface CodeReviewContextData {
  repoPath: string;
  repoRoot?: string;
  headRef?: string;
  mode?: CodeReviewScopeMode;
  baseRef?: string;
  filesCount?: number;
  insertions?: number;
  deletions?: number;
  error?: { message: string };
}

export async function getCodeReviewContextData(repoPath: string): Promise<CodeReviewContextData> {
  const resolved = path.resolve(repoPath);
  try {
    const repoRoot = await git(resolved, ['rev-parse', '--show-toplevel']);
    const headRef =
      (await git(repoRoot, ['branch', '--show-current'])) ||
      (await git(repoRoot, ['rev-parse', '--short', 'HEAD']));

    const worktreeFiles = await changedWorktreeFiles(repoRoot);
    let mode: CodeReviewScopeMode = 'worktree';
    let baseRef: string | undefined;
    let files: string[] = [];

    if (worktreeFiles.length > 0) {
      mode = 'worktree';
      files = worktreeFiles;
    } else {
      mode = 'branch';
      try {
        baseRef = await resolveBaseRef(repoRoot);
        const names = await git(repoRoot, [
          'diff',
          '--name-only',
          `${baseRef}...HEAD`,
          '--',
        ]);
        files = uniqueSorted(names.split('\n'));
      } catch {
        files = [];
      }
    }

    // Run diff stats
    let insertions = 0;
    let deletions = 0;
    try {
      const statsStdout =
        mode === 'worktree'
          ? await worktreeNumstat(repoRoot, files)
          : await git(repoRoot, ['diff', '--numstat', `${baseRef}...HEAD`]);
      const totals = parseNumstatTotals(statsStdout);
      insertions = totals.insertions;
      deletions = totals.deletions;
    } catch {
      // ignore diff stats failures
    }

    return {
      repoPath: resolved,
      repoRoot,
      headRef,
      mode,
      baseRef,
      filesCount: files.length,
      insertions,
      deletions,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      repoPath: resolved,
      error: { message },
    };
  }
}
