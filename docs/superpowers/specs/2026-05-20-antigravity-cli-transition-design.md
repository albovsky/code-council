# Design Spec: Transitioning Gemini CLI to Antigravity CLI

This specification outlines the unified transition of the legacy `gemini-cli` / `gemini` reviewer integration to the new `antigravity-cli` / `antigravity` reviewer integration, matching the official platform updates.

## Goal

To align the Code Council CLI with Google's transition of Gemini CLI (`gemini` binary) to Antigravity CLI (`agy` binary). This involves renaming internal IDs, configurations, database voice records, and UI displays to present a premium, unified **Antigravity CLI** experience, while preserving absolute backward compatibility for existing installs and database configurations.

## Proposed Changes

### 1. CLI Detection & Paths

- Rename the `DetectableCli` identifier `'gemini-cli'` to `'antigravity-cli'`.
- Configure binary name lookup order to prefer `agy` (Antigravity CLI) and fall back to `gemini` (Legacy Gemini CLI).
- Update the version probe and path validation basenames to accept both `agy` and `gemini`.

### 2. Lineage & Brand Maps

- Rename the `UILineage` key `"gemini"` to `"antigravity"`.
- Update human-facing UI labels:
  - `"gemini"` -> `"Antigravity"`
  - `"gemini-cli"` -> `"Antigravity CLI"`
- Retain Google brand colors and visual styling.

### 3. Agent Shim & Orchestrator

- Rename `src/daemon/agents/gemini.ts` to `src/daemon/agents/antigravity.ts`.
- Rename `src/daemon/orchestrators/gemini.ts` to `src/daemon/orchestrators/antigravity.ts`.
- Refactor the inner logic of both files to reference `'antigravity-cli'` internally and handle the `agy` / `gemini` binaries dynamically.

### 4. Database Migration & Backward Compatibility

- Update the voice seeder to migrate any historical `'gemini-cli'` database entries to `'antigravity-cli'`.
- Automatically migrate any legacy settings like `gemini.enabled_models` to `antigravity.enabled_models` upon boot.

## Verification Plan

- Run unit tests to verify the detection logic.
- Run `council doctor` and `council diagnose` to verify proper CLI detection under the new `antigravity-cli` label.
