import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  appendParticipantEvent,
  permissionAutoApprovedEvent,
  readParticipantEvents,
} from '../src/lib/server/participant-events';
import type { CliError } from '../src/daemon/error-detector';

describe('participant event sidecar', () => {
  it('persists and reads permission auto-approved events', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'participant-events-'));
    try {
      const err: CliError = {
        kind: 'permission_prompt',
        lineage: 'opencode',
        message: 'opencode is showing an approval dialog.',
        detail: '# Show OS release info\n$ cat /etc/os-release',
        permissionRequest: {
          summary: 'Show OS release info',
          command: 'cat /etc/os-release',
        },
      };

      appendParticipantEvent(
        dir,
        permissionAutoApprovedEvent(err, ['Right', 'Enter', 'Enter'], 123),
      );

      expect(readParticipantEvents(dir)).toEqual([
        {
          kind: 'permission_auto_approved',
          severity: 'info',
          message: 'Permission auto-approved: cat /etc/os-release',
          detail: '# Show OS release info\n$ cat /etc/os-release',
          command: 'cat /etc/os-release',
          summary: 'Show OS release info',
          ts: 123,
        },
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ignores malformed rows and drops malformed optional fields', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'participant-events-'));
    try {
      fs.writeFileSync(
        path.join(dir, '_events.jsonl'),
        [
          JSON.stringify({
            kind: 'permission_blocked',
            severity: 'error',
            message: 'Permission blocked',
            detail: 123,
            command: ['cat'],
            summary: 'Safe summary',
            ts: 456,
          }),
          JSON.stringify({
            kind: 'bad_severity',
            severity: 'fatal',
            message: 'Nope',
            ts: 789,
          }),
          '{not json',
          JSON.stringify({
            kind: 'bad_ts',
            severity: 'warning',
            message: 'Nope',
            ts: '789',
          }),
        ].join('\n'),
      );

      expect(readParticipantEvents(dir)).toEqual([
        {
          kind: 'permission_blocked',
          severity: 'error',
          message: 'Permission blocked',
          summary: 'Safe summary',
          ts: 456,
        },
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
