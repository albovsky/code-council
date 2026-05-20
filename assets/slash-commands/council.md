---
description: Run a multi-LLM Code Council peer review on a task
argument-hint: [template] <work description>
---

Route this request to the Code Council MCP server. Use the `mcp__council__*` tools — do NOT try to do the review yourself.

**Arguments:** $ARGUMENTS

## Steps

1. **Resolve the template.** If $ARGUMENTS starts with a known template id (e.g. `bug-diagnose`, `code-review`, `red-green`, `architecture`), peel it off as the template and treat the rest as the work payload. Otherwise call `mcp__council__list_templates`, show the user `name + description` for each, and ask which to use. Don't guess — picking the wrong template wastes a multi-minute, multi-LLM run.

2. **Create the chat.** Call `mcp__council__create_chat` with `{ template, work }`. Capture the returned `chatId`.

3. **Wait for the result.** Call `mcp__council__wait_for_chat({ chatId })`. Stream any progress notifications back to the user as they arrive (template phases, reviewer verdicts).

4. **Summarise.** When the chat completes, report:
   - The final verdict (approved / changes-requested / blocked)
   - The 3-5 highest-priority findings, each with a one-line rationale and a file:line pointer if the reviewer gave one
   - The Code Council cockpit URL for the run if available (typically `http://127.0.0.1:5050/runs/<chatId>`)

   Do not paste the full transcript. The user can open the run page for that.

## Failure handling

- If `create_chat` returns `MCP server council not connected` or any tool throws a connection error, tell the user to run `council start` (or `council status` to check) and retry. Do not fall back to doing the review yourself.
- If the chat is `blocked` (waiting for human input), surface the question verbatim and stop — let the user respond via `mcp__council__resume_chat`.
- If the chat fails (`failed` status), report the error from `get_chat_status` and suggest the cockpit URL for the full log.

## Hard rules

- Never substitute your own review for a Code Council run when the user asked for `/council` — the whole point is cross-lineage second opinions.
- Never invent a template id. If $ARGUMENTS doesn't match a real template, ask.
- Never call `cancel_chat` unless the user explicitly asks to abort.
