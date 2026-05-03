/**
 * Gemini CLI (`gemini -p --output-format stream-json`).
 *
 * Real format captured 2026-04-30 from gemini-cli with model
 * gemini-3.1-pro-preview:
 *   {"type":"init", "session_id", "model"}
 *   {"type":"message", "role":"user", "content":"..."}
 *   {"type":"message", "role":"assistant", "content":"<chunk>", "delta":true}
 *   {"type":"result", "status":"success", "stats":{...}}
 *
 * The `result` line carries only stats — final text is the concatenation
 * of all `delta:true` chunks. Runner accumulates from text_delta events
 * and uses that on `message_done` (which we emit with finalText="" so
 * the runner's fallback to `accumulated` kicks in).
 */
import type { AgentEvent } from '../types.js';
import { tryJson } from './shared.js';

export function parseGemini(line: string): AgentEvent[] {
  const obj = tryJson(line) as Record<string, unknown> | undefined;
  if (!obj) return [];

  const t = obj.type;

  if (t === 'message' && obj.role === 'assistant' && obj.delta === true) {
    if (typeof obj.content === 'string' && obj.content.length > 0) {
      return [{ type: 'text_delta', text: obj.content }];
    }
    return [];
  }

  // Tool calls (functionCall). Best-effort detection on common shape variants.
  if (t === 'message' && obj.functionCall) {
    const fc = obj.functionCall as Record<string, unknown>;
    return [
      {
        type: 'tool_call_start',
        tool: typeof fc.name === 'string' ? fc.name : 'unknown',
        input: fc.args,
      },
    ];
  }

  if (t === 'result') {
    const status = obj.status as string | undefined;
    if (status === 'success') {
      return [{ type: 'message_done', finalText: '' }];
    }
    return [
      {
        type: 'error',
        kind: 'gemini_result_error',
        message:
          typeof obj.error === 'string'
            ? obj.error
            : typeof obj.message === 'string'
              ? obj.message
              : `Gemini result status=${status ?? 'unknown'}`,
      },
    ];
  }

  // init, user-echo message, anything else — silently ignore.
  return [];
}
