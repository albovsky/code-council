# Code Review Modes

Code Council has two launch modes for `/code-review`.

## Fast

Fast is the default. It keeps the existing review-only path:

- refreshes the `branch-code-review` template from currently enabled voices at launch time;
- runs one reviewer pass;
- runs one triage synthesis pass;
- returns the same Valid / Mostly Valid / Noise / Needs Owner Decision / Fix Plan / Validation style report.

Use Fast for low and medium risk diffs where turnaround matters more than exhaustive cross-checking.

## Thermo

Thermo is the strict path for large, risky, or important diffs. It computes the reviewer fleet from enabled voices when Start Review is clicked, then runs a dedicated multi-phase pipeline:

- phase 1: specialist reviewers for architecture, security, correctness, tests, performance, docs, and adversarial noise;
- phase 2: validators cross-check the phase 1 findings;
- phase 3: a final synthesizer prepares the report, with an audit/revision pass when available.

Assignments are deterministic. Known current fleet tiers are:

- `gpt-5.5`: A+
- `opencode-go/deepseek-v4-pro`: A
- `opencode-go/kimi-k2.6`: A-
- `opencode-go/glm-5.1`: B+
- `opencode-go/qwen3.6-plus`: B+
- `opencode-go/minimax-m2.7`: B
- `opencode-go/deepseek-v4-flash`: B-
- `gemini-3.5-flash`: C

Thermo reports coverage gaps when the enabled fleet cannot satisfy critical domains. A security gap requires attention when no A/A+ model is available. Architecture and final synthesis require at least A-. Quota-limited or skipped agents are reported as coverage gaps and do not block later phases from running.

