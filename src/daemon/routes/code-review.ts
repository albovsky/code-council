import type { FastifyInstance } from 'fastify';
import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'yaml';
import { chats, phaseEvents, settings, templates, voices } from '../../lib/db/index.js';
import {
  DEFAULT_CODE_REVIEW_MODE,
  isCodeReviewMode,
  type CodeReviewMode,
} from '../../lib/code-review-modes.js';
import {
  CodeReviewScopeError,
  resolveCodeReviewScope,
  getCodeReviewContextData,
} from '../../lib/git-code-review-scope.js';
import { chatLogger, logger } from '../../lib/logger.js';
import { assignThermoReviewDomains } from '../../lib/thermo-review-assignment.js';
import {
  isReviewOnlyPhase,
  TemplateSchema,
} from '../../lib/template-schema.js';
import { adaptTemplate } from '../template-adapter.js';
import {
  errorResponse,
  successResponse,
  type ApiResponse,
} from '../api-response.js';
import type { ErrorDetector } from '../error-detector.js';
import { runWithEventMultiplex, runWithMultiplex } from '../runner-multiplex.js';
import { packAttachedFiles } from '../runner/prompt-builder.js';
import { runThermoCodeReview } from '../runner/thermo-code-review.js';
import type { TmuxManager } from '../tmux-types.js';

const TEMPLATE_ID = 'branch-code-review';
const THERMO_TEMPLATE_ID = 'branch-code-review-thermo';
const CODE_REVIEW_DISABLED_VOICE_IDS_SETTING_KEY = 'code_review.disabled_voice_ids';

interface RegisterCodeReviewRoutesArgs {
  tmuxMgr?: TmuxManager;
  errorDetector?: ErrorDetector;
  startRun?: boolean;
}

function statusForScopeError(code: CodeReviewScopeError['code']): number {
  return code === 'git_failed' ? 500 : 400;
}

async function getCurrentCodeReviewTemplate() {
  const templateRow = await templates.getById(TEMPLATE_ID);
  if (!templateRow) return null;
  if (templateRow.source !== 'builtin') return templateRow;

  const currentVoices = await voices.list();
  if (!currentVoices.some((v) => v.enabled)) return templateRow;

  const templatePath = path.join(process.cwd(), 'templates', `${TEMPLATE_ID}.yaml`);
  if (!fs.existsSync(templatePath)) return templateRow;

  const canonicalYaml = fs.readFileSync(templatePath, 'utf-8');
  const adapted = adaptTemplate(canonicalYaml, currentVoices);
  if (
    templateRow.yaml === adapted.yaml &&
    templateRow.is_complete === adapted.isComplete
  ) {
    return templateRow;
  }

  return templates.create(TEMPLATE_ID, adapted.yaml, 'builtin', adapted.isComplete);
}

async function ensureThermoTemplate() {
  const existing = await templates.getById(THERMO_TEMPLATE_ID);
  if (existing) return existing;

  return templates.create(
    THERMO_TEMPLATE_ID,
    `id: ${THERMO_TEMPLATE_ID}
name: Thermo Code Review
description: Strict multi-phase code review with specialist reviewers, validation, and synthesis.
author: council
agreementThreshold: 0.66
onThresholdMet: ask
maxRounds: 1
yoloDefault: false
ship:
  enabled: false
phases:
  - id: thermo
    kind: review_only
    title: Thermo Code Review
    description: Thermo runs through a dedicated daemon pipeline; this template exists so run streams can attach.
    reviewer:
      require: 0
      crossLineage: false
      candidates: []
    artifact:
      label: Git diff
      hint: Generated automatically from the current worktree or current branch against main.
      maxBytes: 1048576
    inputs:
      include: []
      exclude: []
`,
    'builtin',
    true,
  );
}

async function getCodeReviewTemplateConfig(options: { refreshBuiltin: boolean }) {
  const templateRow = options.refreshBuiltin
    ? await getCurrentCodeReviewTemplate()
    : await templates.getById(TEMPLATE_ID);
  if (!templateRow) {
    return { templateRow: null, parsedTemplate: null, firstPhase: null };
  }

  const parsedTemplate = TemplateSchema.parse(yaml.parse(templateRow.yaml));
  const firstPhase = parsedTemplate.phases[0];
  return { templateRow, parsedTemplate, firstPhase };
}

function parseSkippedVoiceIds(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error('skippedVoiceIds must be an array of voice ids.');
  }

  return [...new Set(value.filter((item): item is string => typeof item === 'string'))];
}

function normalizeSkippedVoiceIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string'))];
}

async function getSavedSkippedVoiceIds(): Promise<string[]> {
  try {
    return normalizeSkippedVoiceIds(
      await settings.get(CODE_REVIEW_DISABLED_VOICE_IDS_SETTING_KEY),
    );
  } catch {
    return [];
  }
}

async function resolveSkippedVoiceIds(requestValue: unknown): Promise<string[]> {
  const requested = parseSkippedVoiceIds(requestValue);
  if (requested.length > 0) return requested;
  return getSavedSkippedVoiceIds();
}

async function buildPerRunCodeReviewTemplate(skippedVoiceIds: string[]) {
  if (skippedVoiceIds.length === 0) return null;

  const templatePath = path.join(process.cwd(), 'templates', `${TEMPLATE_ID}.yaml`);
  if (!fs.existsSync(templatePath)) return null;

  const skipped = new Set(skippedVoiceIds);
  const currentVoices = await voices.list();
  const activeVoices = currentVoices.filter((voice) => !skipped.has(voice.id));
  if (!activeVoices.some((voice) => voice.enabled)) return null;

  const canonicalYaml = fs.readFileSync(templatePath, 'utf-8');
  const adapted = adaptTemplate(canonicalYaml, activeVoices);
  if (!adapted.isComplete) return null;

  return TemplateSchema.parse(yaml.parse(adapted.yaml));
}

export function registerCodeReviewRoutes(
  fastify: FastifyInstance,
  args: RegisterCodeReviewRoutesArgs = {},
): void {
  const shouldStartRun = args.startRun ?? true;
  if (shouldStartRun && (!args.tmuxMgr || !args.errorDetector)) {
    throw new Error('registerCodeReviewRoutes requires tmuxMgr and errorDetector when startRun=true');
  }

  fastify.get<{ Reply: ApiResponse<object> }>('/code-review/context', async () => {
    const repoPath = process.env.CHORUS_REPO_PATH || process.cwd();
    const data = await getCodeReviewContextData(repoPath);
    return successResponse(data);
  });

  fastify.post<{
    Body: { repoPath?: string; mode?: CodeReviewMode; skippedVoiceIds?: string[] };
    Reply: ApiResponse<object>;
  }>('/code-review', async (request, reply) => {
    const repoPath =
      request.body?.repoPath || process.env.CHORUS_REPO_PATH || process.cwd();
    const mode = request.body?.mode ?? DEFAULT_CODE_REVIEW_MODE;
    let skippedVoiceIds: string[];

    try {
      skippedVoiceIds = await resolveSkippedVoiceIds(request.body?.skippedVoiceIds);
    } catch (err) {
      reply.code(400);
      return errorResponse(
        'validation',
        err instanceof Error ? err.message : 'Invalid skippedVoiceIds.',
      );
    }

    if (!isCodeReviewMode(mode)) {
      reply.code(400);
      return errorResponse(
        'validation',
        'mode must be one of: fast, thermo',
      );
    }

    try {
      if (mode === 'thermo') {
        const { templateRow, firstPhase } = await getCodeReviewTemplateConfig({
          refreshBuiltin: false,
        });
        if (!templateRow) {
          reply.code(500);
          return errorResponse(
            'template_missing',
            `Built-in template "${TEMPLATE_ID}" is missing. Restart the daemon so built-in templates are re-seeded.`,
          );
        }
        if (!templateRow.is_complete) {
          reply.code(400);
          return errorResponse(
            'validation',
            `Template "${TEMPLATE_ID}" needs setup before Code Review can run.`,
          );
        }
        if (!firstPhase || !isReviewOnlyPhase(firstPhase)) {
          reply.code(500);
          return errorResponse(
            'template_invalid',
            `Built-in template "${TEMPLATE_ID}" must start with a review_only phase.`,
          );
        }

        const scope = await resolveCodeReviewScope(repoPath, {
          maxBytes: firstPhase.artifact.maxBytes,
        });
        await ensureThermoTemplate();
        const currentVoices = await voices.list({ enabled: true });
        if (
          skippedVoiceIds.length > 0
          && currentVoices.length > 0
          && currentVoices.every((voice) => skippedVoiceIds.includes(voice.id))
        ) {
          reply.code(400);
          return errorResponse(
            'validation',
            'At least one reviewer must remain active for code review.',
          );
        }
        const assignments = assignThermoReviewDomains({
          voices: currentVoices,
          skippedVoiceIds,
          changedFiles: scope.files,
        });
        const work = [
          scope.title,
          '',
          'Thermo review this git diff with specialist reviewers, cross-validation, final synthesis, and coverage gaps.',
        ].join('\n');

        const chat = await chats.create({
          work,
          template_id: THERMO_TEMPLATE_ID,
          attached_files: JSON.stringify(scope.files),
          repo_path: scope.repoRoot,
          artifact: scope.artifact,
          yolo: false,
        });

        await phaseEvents.create({
          chat_id: chat.id,
          phase_idx: 0,
          phase_kind: 'review',
          role: 'reviewer',
          agent_id: null,
          state: 'drafting',
          output: 'Thermo code review queued.',
          cost_usd: 0,
          tokens_in: 0,
          tokens_out: 0,
          started_at: Date.now(),
          finished_at: null,
        });

        chatLogger(chat.id).info(
          {
            templateId: THERMO_TEMPLATE_ID,
            route: 'POST /code-review',
            mode: scope.mode,
            reviewMode: mode,
            skippedVoiceIds,
            fileCount: scope.files.length,
            totalBytes: scope.totalBytes,
            requestId: request.id,
          },
          'thermo code review chat created',
        );

        if (shouldStartRun && args.tmuxMgr && args.errorDetector) {
          const entry = runWithEventMultiplex({
            chatId: chat.id,
            execute: async ({ abortSignal, onEvent }) => {
              let chatDoneEmitted = false;
              const emit: typeof onEvent = (event) => {
                if (event.type === 'chat_done') chatDoneEmitted = true;
                onEvent(event);
              };
              try {
                await runThermoCodeReview({
                  chatDir: path.join(os.homedir(), '.code-council', 'chats', chat.id),
                  chatId: chat.id,
                  artifact: scope.artifact,
                  work,
                  filesBlock: packAttachedFiles(scope.files, scope.repoRoot),
                  assignments,
                  tmuxMgr: args.tmuxMgr as TmuxManager,
                  errorDetector: args.errorDetector as ErrorDetector,
                  onEvent: emit,
                  abortSignal,
                });
              } catch (err) {
                chatLogger(chat.id).error(
                  { err: err instanceof Error ? err.message : String(err) },
                  'thermo code review runner failed',
                );
                if (!chatDoneEmitted) {
                  emit({
                    chatId: chat.id,
                    type: 'phase_failed',
                    payload: {
                      phaseId: 'thermo-code-review',
                      phaseIdx: 0,
                      kind: 'review',
                      round: 1,
                      role: 'reviewer',
                      agent: 'thermo',
                      reason: 'thermo_runner_failed',
                    },
                    ts: Date.now(),
                  });
                  emit({
                    chatId: chat.id,
                    type: 'chat_done',
                    payload: { status: 'failed', verdict: 'failed' },
                    ts: Date.now(),
                  });
                }
              }
            },
          });
          entry.promise.catch((err: unknown) => {
            chatLogger(chat.id).error(
              { err: err instanceof Error ? err.message : String(err) },
              'code review runner failed',
            );
          });
        }

        return successResponse({
          ...chat,
          codeReview: {
            mode: scope.mode,
            repoRoot: scope.repoRoot,
            baseRef: scope.baseRef,
            headRef: scope.headRef,
            files: scope.files,
            totalBytes: scope.totalBytes,
          },
        });
      }

      const templateConfig = await getCodeReviewTemplateConfig({
        refreshBuiltin: true,
      });
      const { templateRow } = templateConfig;
      let { parsedTemplate, firstPhase } = templateConfig;
      if (!templateRow) {
        reply.code(500);
        return errorResponse(
          'template_missing',
          `Built-in template "${TEMPLATE_ID}" is missing. Restart the daemon so built-in templates are re-seeded.`,
        );
      }
      if (!templateRow.is_complete) {
        reply.code(400);
        return errorResponse(
          'validation',
          `Template "${TEMPLATE_ID}" needs setup before Code Review can run.`,
        );
      }
      if (!firstPhase || !isReviewOnlyPhase(firstPhase)) {
        reply.code(500);
        return errorResponse(
          'template_invalid',
          `Built-in template "${TEMPLATE_ID}" must start with a review_only phase.`,
        );
      }

      if (skippedVoiceIds.length > 0) {
        parsedTemplate = await buildPerRunCodeReviewTemplate(skippedVoiceIds);
        firstPhase = parsedTemplate?.phases[0] ?? null;
        if (!parsedTemplate || !firstPhase || !isReviewOnlyPhase(firstPhase)) {
          reply.code(400);
          return errorResponse(
            'validation',
            'At least one reviewer must remain active for code review.',
          );
        }
      }
      if (!parsedTemplate) {
        reply.code(500);
        return errorResponse(
          'template_invalid',
          `Built-in template "${TEMPLATE_ID}" could not be parsed.`,
        );
      }

      const scope = await resolveCodeReviewScope(repoPath, {
        maxBytes: firstPhase.artifact.maxBytes,
      });
      const work = [
        scope.title,
        '',
        'Review this git diff. At the end, synthesize reviewer feedback into Valid / Mostly Valid / Noise / Needs Owner Decision / Fix Plan / Validation.',
      ].join('\n');

      const chat = await chats.create({
        work,
        template_id: TEMPLATE_ID,
        attached_files: JSON.stringify(scope.files),
        repo_path: scope.repoRoot,
        artifact: scope.artifact,
        yolo: false,
      });
      try {
        await chats.setTemplateSnapshot(chat.id, JSON.stringify(parsedTemplate));
      } catch (err) {
        chatLogger(chat.id).warn(
          { err: err instanceof Error ? err.message : String(err) },
          'failed to persist code-review template snapshot',
        );
      }
      const chatForResponse = (await chats.getById(chat.id)) ?? chat;

      await phaseEvents.create({
        chat_id: chat.id,
        phase_idx: 0,
        phase_kind: 'review_only',
        role: 'doer',
        agent_id: null,
        state: 'drafting',
        output: null,
        cost_usd: 0,
        tokens_in: 0,
        tokens_out: 0,
        started_at: Date.now(),
        finished_at: null,
      });

      chatLogger(chat.id).info(
        {
          templateId: TEMPLATE_ID,
          route: 'POST /code-review',
          mode: scope.mode,
          skippedVoiceIds,
          fileCount: scope.files.length,
          totalBytes: scope.totalBytes,
          requestId: request.id,
        },
        'code review chat created',
      );

      if (shouldStartRun && args.tmuxMgr && args.errorDetector) {
        const entry = runWithMultiplex({
          chatId: chat.id,
          template: parsedTemplate,
          chat,
          tmuxMgr: args.tmuxMgr,
          errorDetector: args.errorDetector,
        });
        entry.promise.catch((err: unknown) => {
          chatLogger(chat.id).error(
            { err: err instanceof Error ? err.message : String(err) },
            'code review runner failed',
          );
        });
      }

      return successResponse({
        ...chatForResponse,
        codeReview: {
          mode: scope.mode,
          repoRoot: scope.repoRoot,
          baseRef: scope.baseRef,
          headRef: scope.headRef,
          files: scope.files,
          totalBytes: scope.totalBytes,
        },
      });
    } catch (error) {
      if (error instanceof CodeReviewScopeError) {
        reply.code(statusForScopeError(error.code));
        return errorResponse(error.code, error.message);
      }
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ requestId: request.id, err: message }, 'code review route failed');
      reply.code(500);
      return errorResponse('code_review_failed', message);
    }
  });
}
