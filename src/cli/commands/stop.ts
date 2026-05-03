import type { Command } from 'commander';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  findPidsOnPort,
  isPortInUse,
  killAndVerify,
} from '../port-utils.js';
import { c, header, sym } from '../ui.js';

/**
 * Two-stage shutdown per managed process: SIGTERM, wait up to 1.5s,
 * escalate to SIGKILL if still alive. Don't unlink the pidfile until
 * the process is confirmed dead — otherwise an orphan that ignores
 * SIGTERM keeps running while we forget about it (the bug behind the
 * "stale next-server serving 500s" incident on 2026-05-03).
 *
 * Belt-and-braces: after pidfile-based shutdown, also sweep ports
 * :7707 (daemon) and :5050 (cockpit). Catches the case where the
 * pidfile was lost or pointed at a recycled PID but a real chorus
 * process still owns the port.
 */
export function registerStopCommand(program: Command): void {
  program
    .command('stop')
    .description('Stop the Chorus daemon and cockpit')
    .action(async () => {
      try {
        const chorusDir = path.join(os.homedir(), '.chorus');
        const daemonPidFile = path.join(chorusDir, 'daemon.pid');
        const webPidFile = path.join(chorusDir, 'web.pid');

        const daemonPidfileExists = fs.existsSync(daemonPidFile);
        const webPidfileExists = fs.existsSync(webPidFile);
        const daemonPortInUse = await isPortInUse(7707);
        const cockpitPortInUse = await isPortInUse(5050);

        if (
          !daemonPidfileExists &&
          !webPidfileExists &&
          !daemonPortInUse &&
          !cockpitPortInUse
        ) {
          console.log('');
          console.log(header(sym.info, 'Chorus is not running', 'nothing to stop'));
          console.log('');
          return;
        }

        console.log('');
        console.log(header(sym.pointer, 'Stopping Chorus...'));
        console.log('');

        await stopProcess('Daemon', daemonPidFile);
        await stopProcess('Cockpit', webPidFile);

        // Port-based sweep — kills any chorus-owned listener that
        // escaped the pidfile path. Errs on the side of cleanup;
        // running a non-chorus service on these ports while invoking
        // `chorus stop` is unsupported.
        await sweepPort(7707, 'Daemon');
        await sweepPort(5050, 'Cockpit');

        console.log('');
      } catch (error) {
        console.error(`${sym.err} ${c.red('Error stopping chorus:')}`, error);
        process.exit(1);
      }
    });
}

async function stopProcess(label: string, pidFile: string): Promise<void> {
  if (!fs.existsSync(pidFile)) return;
  const pid = parseInt(fs.readFileSync(pidFile, 'utf-8'), 10);
  if (!Number.isFinite(pid) || pid <= 0) {
    fs.unlinkSync(pidFile);
    return;
  }
  const dead = await killAndVerify(pid, label);
  if (dead) {
    console.log(`  ${sym.ok} ${label.padEnd(7)} ${c.dim(`(PID ${pid})`)}`);
    // Only unlink once we've confirmed the process is gone. Earlier
    // code unconditionally unlinked, which orphaned any process that
    // ignored SIGTERM — its successor `chorus start` couldn't see
    // the ghost owner of the port.
    try {
      fs.unlinkSync(pidFile);
    } catch {
      /* already gone */
    }
  }
}

async function sweepPort(port: number, label: string): Promise<void> {
  const pids = findPidsOnPort(port);
  for (const pid of pids) {
    const dead = await killAndVerify(pid, `${label} orphan`);
    if (dead) {
      console.log(
        `  ${sym.ok} ${label.padEnd(7)} ${c.dim(`(orphan PID ${pid} on :${port})`)}`,
      );
    }
  }
}
