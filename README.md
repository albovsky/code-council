# Chorus

> Driver-agnostic multi-LLM peer review for code decisions.

Bring your own AI coding CLI (Claude Code, Codex, Cursor, Windsurf). Chorus convenes 2-4 other LLMs of different lineages to peer-review the work before you ship.

**Status:** v0.5 in development. Target ship: 2026-05-22.

## Install (when published)

```bash
npm i -g chorus
chorus init      # one-time setup wizard
chorus start     # start the daemon + open the cockpit
```

## Commands

```
chorus start [--ui]    # start daemon (and optionally open browser)
chorus ui              # open the cockpit in your browser
chorus mcp             # run MCP server on stdio (called by orchestrators)
chorus stop            # stop the daemon
chorus status          # daemon health
```

## Architecture

- **CLI** (`bin/chorus.js`) — entry point shipped via `npm i -g chorus`
- **Daemon** (`src/daemon/`) — Fastify on `localhost:7707`, SQLite for state, tmux session manager
- **MCP server** (`src/mcp/`) — primary input surface, 7 stdio tools (create_chat, wait_for_chat, get_chat_status, list_blocked, resume_chat, cancel_chat, list_templates)
- **Web UI** (`src/app/`) — Next.js 16 cockpit at `localhost:3011`
- **Templates** (`templates/`) — 4 built-in YAML templates: code-review, bug-diagnose, architect-review, red-green

## License

Apache-2.0 (once public). Private during development.

## Links

- Predecessor prototype: https://murmur.99x.agency (frozen v0.2 reference)
- Dev environment: https://chorus.99x.agency (this build)
- Production target: https://chorus.codes (launch 2026-05-22)
