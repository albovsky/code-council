import type { FastifyInstance } from 'fastify';
import yaml from 'yaml';
import { chats, phaseEvents, templates } from '../../lib/db/index.js';
import {
  CodeReviewScopeError,
  resolveCodeReviewScope,
} from '../../lib/git-code-review-scope.js';
import { chatLogger, logger } from '../../lib/logger.js';
import {
  isReviewOnlyPhase,
  TemplateSchema,
} from '../../lib/template-schema.js';
import {
  errorResponse,
  successResponse,
  type ApiResponse,
} from '../api-response.js';
import type { ErrorDetector } from '../error-detector.js';
import { runWithMultiplex } from '../runner-multiplex.js';
import type { TmuxManager } from '../tmux-types.js';

const TEMPLATE_ID = 'branch-code-review';

interface RegisterCodeReviewRoutesArgs {
  tmuxMgr?: TmuxManager;
  errorDetector?: ErrorDetector;
  startRun?: boolean;
}

function statusForScopeError(code: CodeReviewScopeError['code']): number {
  return code === 'git_failed' ? 500 : 400;
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
    return successResponse({ repoPath });
  });

  fastify.post<{
    Body: { repoPath?: string };
    Reply: ApiResponse<object>;
  }>('/code-review', async (request, reply) => {
    const repoPath =
      request.body?.repoPath || process.env.CHORUS_REPO_PATH || process.cwd();

    try {
      const templateRow = await templates.getById(TEMPLATE_ID);
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

      const parsedTemplate = TemplateSchema.parse(yaml.parse(templateRow.yaml));
      const firstPhase = parsedTemplate.phases[0];
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
