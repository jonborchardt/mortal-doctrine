// Runs a command (the dev servers) and, on Windows, ends its whole process tree when the `pnpm`
// run that started it is killed. See docs/development.md#dev-servers.
// Runs directly under Node 24 type stripping: keep it dependency-free and erasable-syntax only.
//
// Usage: node scripts/dev.ts <command> [args...]
import { execFile, execFileSync, spawn } from 'node:child_process';

const POLL_MS = 500;
const windows = process.platform === 'win32';
const [command, ...args] = process.argv.slice(2);
if (command === undefined) {
  console.error('usage: node scripts/dev.ts <command> [args...]');
  process.exit(2);
}

/** Quotes one argument for cmd.exe, which Windows needs to start `.cmd` shims such as pnpm. */
function quote(arg: string): string {
  return /^[\w./:\\=@-]+$/.test(arg) ? arg : `"${arg.replaceAll('"', '\\"')}"`;
}

const child = windows
  ? spawn([command, ...args].map(quote).join(' '), { stdio: 'inherit', shell: true })
  : spawn(command, args, { stdio: 'inherit' });

child.on('error', (error) => {
  console.error(`dev: cannot start ${command}: ${error.message}`);
  process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 1));

// Ctrl+C reaches the whole console process group, so the child gets it too: wait for it to finish.
process.on('SIGINT', () => {});
// A SIGTERM goes to this process only: pass it on. (Never delivered on Windows.)
process.on('SIGTERM', () => child.kill('SIGTERM'));

if (windows) watchAncestors();

/**
 * Windows does not pass a kill down the process tree: killing `pnpm` (Task Manager, `taskkill`
 * without `/T`, a job runner) would orphan everything below it, and runs no handler here. So poll
 * the processes that make up the `pnpm` run above this one and end the tree when one is gone.
 */
function watchAncestors(): void {
  const watched = [process.ppid];
  // The direct parent is the cmd.exe that pnpm starts scripts with, and it outlives pnpm. Find
  // the rest of the chain (pnpm itself, the corepack shim, the `pnpm.cmd` shell) by command line.
  execFile(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.CommandLine)" }',
    ],
    { windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
    (error, stdout) => {
      if (error) return; // Still watching the direct parent.
      const processes = new Map<number, { parent: number; commandLine: string }>();
      for (const line of stdout.split(/\r?\n/)) {
        const match = /^(\d+) (\d+) (.*)$/.exec(line);
        if (match) {
          processes.set(Number(match[1]), { parent: Number(match[2]), commandLine: match[3]! });
        }
      }
      let pid = processes.get(process.ppid)?.parent;
      while (pid !== undefined && !watched.includes(pid)) {
        const ancestor = processes.get(pid);
        // Gone already (killed before this listing) counts as dead: keep it so the poll sees it.
        if (ancestor && !/pnpm/i.test(ancestor.commandLine)) break;
        watched.push(pid);
        pid = ancestor?.parent;
      }
    },
  );

  // PID reuse could hide a death; the window is too small to engineer around.
  setInterval(() => {
    if (watched.every(isAlive)) return;
    try {
      execFileSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore' });
    } catch {
      // The tree is already gone.
    }
    process.exit(1);
  }, POLL_MS).unref();
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists but belongs to someone else (for example an elevated shell).
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}
