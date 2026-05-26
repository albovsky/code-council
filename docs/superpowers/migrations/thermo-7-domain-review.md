# Thermo 7-Domain Review Operator Note

Thermo runs seven specialist review domains:

- Plan completeness
- Architecture
- Security
- Correctness
- Tests
- Performance
- Docs

The final synthesis starts with a `Verdict:` line. Supported values are `safe_to_merge`, `changes_requested`, `owner_decision_needed`, `human_review_required`, and `no_verdict`.

Only `safe_to_merge` maps to approved. Every other verdict maps to request changes.

Participant cards may show `SKIPPED` when a specialist was intentionally not run, and `NOT RUN` when a run failed or was cancelled before that participant started.
