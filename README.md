<div align="center">

<img src="docs/images/logo.png" alt="Chorus" width="120" />

# Chorus

**A second opinion (and a third) before you ship AI-written code.**
The same AI that wrote your code can't catch its own blind spots. Chorus runs your work past 2–3 *different* AI tools — in parallel — and only gives the green light when they agree.

[![CI](https://github.com/99xAgency/chorus/actions/workflows/ci.yml/badge.svg)](https://github.com/99xAgency/chorus/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/chorus-codes?color=22c55e)](https://www.npmjs.com/package/chorus-codes)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](./LICENSE)
[![Status](https://img.shields.io/badge/status-v0.7-brightgreen)]()
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933)]()

[Website](https://chorus.codes) · [Roadmap](./ROADMAP.md) · [Issues](https://github.com/99xAgency/chorus/issues)

---

<img src="docs/images/hero-demo.gif" alt="Three AI tools reviewing the same diff in parallel" width="800" />

*One AI writes. Three review. You ship only when they agree.*

</div>

---

## The problem Chorus solves

AI coding tools are fast, confident, and wrong about 5% of the time in ways that are easy to miss. The same model that wrote your code can't see its own gaps. And asking GPT to review GPT's work is theatre — same blind spots, same biases.

Chorus fixes that by being the missing review pass:

1. One AI writes (or you write the code yourself).
2. **2–3 AIs from different vendors** read the result in parallel.
3. They each tell you "ship it" or "wait, this breaks if X".
4. Disagreement is a red flag — you see it before you merge.

That's the whole pitch.

---

## Real moments where this matters

**You asked Claude to write a `divide(a, b)` helper.**
It says "looks correct!" You ship. Production crashes at 2am because nobody handled `b = 0`.
*With Chorus: GPT or Gemini would have flagged it in the review pass before you merged.*

**You're refactoring a critical path.**
Your AI rewrote 200 lines and says it's behaviour-equivalent. You're tired and skeptical.
*Run it through Chorus. Three different AIs all saying "yes, equivalent" lets you sleep.*

**Big architectural call** — queue vs polling, sync vs async, this DB vs that one.
Write a paragraph, hit Chorus. *Three different models give you three angles you hadn't thought of.*

**Reviewing a 600-line PR.**
You're short on time. Paste the diff into Chorus. *Three reviewers spot the obvious bugs in 90 seconds. Your job becomes the 5% they couldn't catch.*

**Test-driven development where neither AI cheats.**
*One AI writes tests blind to the code; another AI writes code to pass them.* Use the `red-green` template.

---

## Quick start

```bash
npm i -g chorus-codes      # install
chorus init                # finds AI tools you already have
chorus start --ui          # opens http://localhost:5050
```

Paste a task. Hit submit. Watch the AIs argue.

**Requires** Node 20+ and at least *one* of these (you probably already have one):

- Claude Code, Codex CLI, Gemini CLI, OpenCode, or Kimi CLI — uses your existing subscription, no extra cost
- *or* an OpenRouter API key (one key, 200+ models, pay-per-use)

<details>
<summary><b>Don't have any of those?</b></summary>

```bash
npm i -g @anthropic-ai/claude-code   # Anthropic — uses Claude Pro sub
npm i -g @openai/codex                # OpenAI — uses ChatGPT Plus sub
npm i -g @google/gemini-cli           # Google — uses Gemini Advanced sub
```

Pick whichever vendor you already pay for. Or skip CLIs entirely and add an OpenRouter key in Settings after `chorus init`.

</details>

---

## What it looks like

<table>
<tr>
<td width="50%" align="center">
<b>Live review</b><br/>
<img src="docs/images/run-page.gif" alt="Three reviewers streaming verdicts in real-time" width="100%" /><br/>
<sub>Each AI streams its thinking live as it reviews.</sub>
</td>
<td width="50%" align="center">
<b>Verdict</b><br/>
<img src="docs/images/verdict.gif" alt="Final converged verdict with merged diff" width="100%" /><br/>
<sub>Agreement = green. Disagreement = retry with their feedback.</sub>
</td>
</tr>
<tr>
<td width="50%" align="center">
<b>Templates</b><br/>
<img src="docs/images/templates.gif" alt="Template editor" width="100%" /><br/>
<sub>Pre-built review patterns. Make your own in YAML.</sub>
</td>
<td width="50%" align="center">
<b>From inside Claude / Cursor</b><br/>
<img src="docs/images/mcp.gif" alt="Claude Code calling Chorus" width="100%" /><br/>
<sub>Any AI tool that speaks MCP can trigger a Chorus run.</sub>
</td>
</tr>
</table>

---

## A real example

You ask Claude to write this:

```js
function divide(a, b) {
  return a / b;
}
```

Submit to Chorus with the **Code Review** template (1 writer + 2 reviewers, both must agree to ship):

| Step | What happens |
|---|---|
| 1. Claude writes | "Looks correct to me!" |
| 2. GPT reviews in parallel | 🚨 *No type validation — `divide('a','b')` returns `NaN`* |
| 3. Gemini reviews in parallel | 🚨 *Missing zero-check — `divide(1, 0)` returns `Infinity`* |
| 4. Verdict | ❌ **REJECT** — both reviewers flagged real bugs |

Now you know what to fix **before** you push.

---

## Templates: pre-built review patterns

Don't figure out which AIs to use yourself. Pick a pattern that fits the moment:

| Use this when... | Template |
|---|---|
| Pre-merge sanity check | `code-review` — 1 writer + 2 reviewers, both must agree |
| Diagnosing a weird bug | `bug-diagnose` — one hypothesises, one challenges |
| Big architectural call | `architect-review` — 3 different vendors critique your plan |
| TDD where neither AI cheats | `red-green` — tests written blind to code |
| Quick audit of a diff someone else wrote | `review-only` — paste, get 3 opinions, no writer |

Make your own by dropping a YAML file in `~/.chorus/templates/`. Or duplicate one of the built-ins and tweak.

<details>
<summary><b>Custom template example</b></summary>

```yaml
id: security-pre-merge
label: Security Pre-Merge
description: Sentinel persona on every reviewer; everyone must approve.
slots:
  doer:
    lineage: anthropic
    model: claude-sonnet-4-6
  reviewers:
    - { lineage: openai,   model: codex,                 persona: sentinel }
    - { lineage: google,   model: gemini-2.5-pro,        persona: sentinel }
    - { lineage: opencode, model: opencode-go/kimi-k2.6, persona: sentinel }
quorum:
  type: unanimous
```

</details>

---

## Reviewer personas

Each reviewer can wear a "hat" — a focus area Chorus prepends to their prompt:

| Persona | What they look for |
|---|---|
| 🛡️ **Sentinel** | Security holes, auth bypass, injection |
| 🗺️ **Cartographer** | Cross-platform issues (Windows vs Mac, browser support) |
| 💰 **Accountant** | Cost regressions (extra DB queries, API calls) |
| ⚡ **Profiler** | Performance regressions |
| 🔍 **Inspector**, 📦 **Quartermaster**, 🛎️ **Concierge**, 🏛️ **Conservator**, 📚 **Librarian**, 🌐 **Translator** | …and more — see Personas page in cockpit |

Different personas reviewing the same change = wider net.

---

## Why "different vendors" matters

You can run Chorus with three Claudes. We let you. But the value drops a lot.

A second Claude reviewing the first Claude's work is theatre — same training, same blind spots. Mix vendors (Claude + GPT + Gemini) and you get genuinely different angles, because they were trained on different data with different biases.

Templates let you encode this: each reviewer slot has a `lineage` (anthropic / openai / google / opencode / moonshot). Built-in templates mix vendors automatically.

---

## What does it cost?

Two paths, depending on how you already pay for AI:

**Using subscriptions** (Claude Pro / ChatGPT Plus / Gemini Advanced — ~$20/mo each)
A typical review = **$0** out of pocket. Counts against the quota you already have.

**Using API keys** (pay-per-use)
A typical code-review run = **$0.30 to $1.50**, depending on diff size. If reviewers disagree and retry, 2–3× worst case.

Chorus adds **zero markup**. We don't see your tokens.

---

## Permissions & safety

Reviewers run on your machine. You decide how much trust to give them:

| Mode | Read code | Write code | Network | When to use |
|---|:---:|:---:|:---:|---|
| 🔒 **Strict** | ✅ | ❌ | ❌ | Reviewing a diff you don't trust |
| 📁 **Workspace** *(default)* | ✅ | ✅ inside chat dir | ❌ | Day-to-day |
| 🔓 **Full** | ✅ | ✅ anywhere | ✅ | Personal machine, full trust |

Configure on first run, or anytime at *Settings → Permissions*.

> **Trust model in plain English.** "Workspace" means the reviewer can write files inside its working directory and run scoped commands, but can't reach the internet or write outside the sandbox. "Full" means anything-goes — only enable on a personal machine you own. Run `chorus doctor` to verify each AI tool got the sandbox you set.

---

## Use it from inside another AI tool

Chorus speaks MCP — the protocol Claude Code, Cursor, Codex, Gemini CLI etc. use to talk to other tools. So you can trigger a Chorus run *from inside* the AI tool you're already using.

Example, inside Claude Code:

> *"Run code-review on the diff against main using Chorus"*

Claude Code calls Chorus → Chorus fans out to other AI tools → results stream back into Claude Code. Useful when you want a second opinion without leaving the editor.

`chorus init` wires up MCP for the orchestrators it detects (Claude / Codex / Gemini / Cursor / Windsurf, etc.).

---

## Compared to other code-review tools

| | **Chorus** | CodeRabbit | Greptile | Cursor Review | GitHub Copilot |
|---|:---:|:---:|:---:|:---:|:---:|
| Multiple AI vendors review the same change | ✅ | ❌ | ❌ | ❌ | ❌ |
| Uses your existing AI subscriptions | ✅ | ❌ | ❌ | ❌ | ❌ |
| Runs locally (your code never leaves your existing AI vendors) | ✅ | ❌ | ❌ | partial | ❌ |
| Open source (modify + self-host) | ✅ Apache-2.0 | ❌ | ❌ | ❌ | ❌ |
| Custom review patterns | ✅ | partial | ❌ | ❌ | ❌ |

**The unique thing:** your code never goes to a new vendor. Chorus just orchestrates the AI tools you already use.

---

## Commands

```bash
chorus init             # one-time: detect + connect AI tools
chorus start --ui       # boot + open browser
chorus stop             # shut it down
chorus status           # is it running?
chorus doctor           # diagnose AI tool detection / sandbox issues
```

---

## Telemetry

Chorus pings home once on startup and once every 24h. The payload is fixed:

```json
{
  "schema": 1,
  "installId": "<random uuid>",
  "version": "0.7.0",
  "os": "linux", "arch": "x64", "node": "22",
  "daemonUptimeSeconds": 86400,
  "chatsLast24h": 12
}
```

**Never sent:** chat content, prompts, file paths, repo paths, model names, voice/template names, hostnames, IPs, API keys.

Turn it off any of three ways:

```bash
export CHORUS_TELEMETRY=0           # env var
touch ~/.chorus/no-telemetry        # touch-file
# or click "Off" in cockpit Settings → Telemetry
```

The install ID lives at `~/.chorus/install-id` — `rm` it for a fresh one.

---

## Roadmap

- [x] **v0.5** — Daemon + cockpit + 4 AI vendors
- [x] **v0.6** — MCP server, persona system
- [x] **v0.7** — OpenRouter integration, voices table, real-time sidebar
- [ ] **v0.8** — Multi-stage review (write → review → fix → re-review)
- [ ] **v0.9** — Per-voice persona overrides, voice marketplace
- [ ] **v1.0** — Hosted GitHub App + cloud fan-out

Full picture in [ROADMAP.md](./ROADMAP.md).

---

<details>
<summary><b>How it works (under the hood)</b></summary>

```mermaid
flowchart TB
    User([👤 You])
    Cockpit[Cockpit<br/>:5050 · web UI]
    Daemon[Chorus daemon<br/>:7707 · local server]
    DB[(SQLite<br/>~/.chorus/chorus.db)]
    MCP[MCP server<br/>for editor integrations]

    Claude[🤖 Claude<br/>writer]
    Codex[🦾 GPT<br/>reviewer]
    Gemini[💎 Gemini<br/>reviewer]

    User -->|paste task| Cockpit
    Cockpit <-->|REST + live updates| Daemon
    Daemon <--> DB
    Daemon -->|spawn| Claude
    Daemon -->|spawn| Codex
    Daemon -->|spawn| Gemini
    User -.->|"call Chorus from your AI"| MCP --> Daemon

    classDef user fill:#fef3c7,stroke:#f59e0b,color:#000
    classDef chorus fill:#dbeafe,stroke:#3b82f6,color:#000
    classDef llm fill:#fce7f3,stroke:#ec4899,color:#000
    class User user
    class Daemon,Cockpit,MCP,DB chorus
    class Claude,Codex,Gemini llm
```

**Three pieces:**

- **Daemon** — small local server (port 7707) that spawns AI tools as subprocesses, parses their output, and tracks state in a SQLite database at `~/.chorus/chorus.db`.
- **Cockpit** — the web UI at port 5050 (Next.js). Templates, chats, voices, settings.
- **MCP server** — lets *other* AI tools (Claude Code, Cursor, etc.) call Chorus programmatically.

Each AI runs as an isolated subprocess. Chorus reads their structured output (stream-JSON), compares against the template's quorum rule, and emits a verdict. Nothing leaves your machine except the calls to the AI vendors you already use.

Code layout:
- `src/daemon/` — Fastify server + agent shims (one per AI tool)
- `src/app/` — Next.js cockpit
- `src/mcp/` — JSON-RPC MCP server
- `src/lib/db/` — schema + migrations

</details>

---

## Contributing

PRs welcome.

```bash
git clone https://github.com/99xAgency/chorus.git
cd chorus && pnpm install
pnpm dev:daemon   # daemon on :7707
pnpm dev          # cockpit on :5050
pnpm test         # full suite
```

Read [`AGENTS.md`](./AGENTS.md) first — Next.js 16 has breaking changes from older versions. Coverage target on new code: 80%+.

We dogfood: PRs to Chorus go through Chorus before merging.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full guide.

---

## Links

- 🌐 Website: <https://chorus.codes>
- 🗺️ Roadmap: [./ROADMAP.md](./ROADMAP.md)
- 🐛 Issues: <https://github.com/99xAgency/chorus/issues>
- 💬 Discussions: <https://github.com/99xAgency/chorus/discussions>
- 🐦 Twitter / X: [@chorus_codes](https://twitter.com/chorus_codes)

---

## License

[Apache-2.0](./LICENSE). Use it however you want, including commercially.

---

<div align="center">

**Made with 🎵 by [99x.agency](https://99x.agency)**

*Because one AI just isn't enough.*

</div>
