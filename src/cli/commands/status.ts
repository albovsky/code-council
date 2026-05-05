import type { Command } from 'commander';
import { COCKPIT_URL, DAEMON_URL } from '../shared.js';
import { c, header, kv, sym } from '../ui.js';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Check daemon health')
    .action(async () => {
      try {
        const response = await fetch(`${DAEMON_URL}/api/v1/health`);
        if (!response.ok) {
          console.log('');
          console.log(
            header(sym.err, 'Daemon is not running', 'start with `chorus start`'),
          );
          console.log('');
          process.exit(1);
        }

        const envelope = (await response.json()) as {
          ok: boolean;
          data?: { version: string; uptime: number };
        };
        const data = envelope.data;

        if (envelope.ok && data) {
          const uptime = Math.floor(data.uptime / 1000);
          const human =
            uptime < 60
              ? `${uptime}s`
              : uptime < 3600
                ? `${Math.floor(uptime / 60)}m`
                : `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`;
          console.log('');
          console.log(header(sym.ok, 'Chorus is running'));
          console.log('');
          console.log(
            kv([
              ['Version', c.cyan(data.version)],
              ['Uptime', c.dim(human)],
              ['Cockpit', c.cyan(COCKPIT_URL)],
              ['Daemon', c.dim(DAEMON_URL)],
            ]),
          );
          console.log('');
        } else {
          console.log('');
          console.log(header(sym.err, 'Daemon is not responding correctly'));
          console.log('');
          process.exit(1);
        }
      } catch {
        console.log('');
        console.log(
          header(sym.err, 'Daemon is not running', 'start with `chorus start`'),
        );
        console.log('');
        process.exit(1);
      }
    });
}
