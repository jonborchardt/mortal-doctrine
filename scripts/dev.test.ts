import { execFileSync, spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const launcher = join(import.meta.dirname, 'dev.ts');
const fixture = join(import.meta.dirname, 'fixtures', 'dev-tree.ts');

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Starts `pnpm run dev` and returns the process whose death must end the run. On Windows that is
 * the shell running the `pnpm` shim, as started by a terminal or a job runner: its kill does not
 * reach the processes below it. Elsewhere it is the pnpm running this test, which passes a
 * SIGTERM down by itself.
 */
function spawnPnpmDev(cwd: string): ChildProcess {
  const options: SpawnOptions = { cwd, stdio: ['ignore', 'pipe', 'inherit'] };
  if (process.platform === 'win32') return spawn('pnpm run dev', { ...options, shell: true });
  const pnpm = process.env['npm_execpath'] ?? 'pnpm';
  return /\.[cm]?js$/.test(pnpm)
    ? spawn(process.execPath, [pnpm, 'run', 'dev'], options)
    : spawn(pnpm, ['run', 'dev'], options);
}

describe('dev launcher', () => {
  const started: number[] = [];
  const directories: string[] = [];

  afterEach(() => {
    for (const pid of started.splice(0)) {
      try {
        if (process.platform === 'win32') {
          execFileSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore' });
        } else {
          process.kill(pid, 'SIGKILL');
        }
      } catch {
        // Already gone: the expected case.
      }
    }
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true, maxRetries: 10 });
    }
  });

  it('exits with the exit code of the command', async () => {
    const child = spawn(process.execPath, [launcher, process.execPath, fixture, '7'], {
      stdio: 'ignore',
    });
    started.push(child.pid!);
    const code = await new Promise((resolve) => child.on('exit', resolve));
    expect(code).toBe(7);
  });

  it('leaves no process behind when the pnpm run that started it is killed', async () => {
    // A `pnpm dev` like the real one: pnpm runs a package script that calls the launcher.
    const directory = mkdtempSync(join(tmpdir(), 'dev-launcher-'));
    directories.push(directory);
    const dev = `node "${launcher}" node "${fixture}"`;
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ scripts: { dev } }));

    const pnpm = spawnPnpmDev(directory);
    started.push(pnpm.pid!);
    let output = '';
    pnpm.stdout!.on('data', (chunk: Buffer) => (output += chunk.toString()));
    const pids = await vi.waitFor(
      () => {
        const match = /^pids (\d+) (\d+) (\d+)$/m.exec(output);
        if (!match) throw new Error(`no PIDs yet in: ${output}`);
        return match.slice(1).map(Number);
      },
      { timeout: 30_000, interval: 50 },
    );
    started.push(...pids);
    expect(pids.filter(isAlive)).toEqual(pids);

    // TerminateProcess on Windows (a non-console kill, no tree), a plain SIGTERM elsewhere.
    process.kill(pnpm.pid!);

    await vi.waitFor(() => expect([pnpm.pid!, ...pids].filter(isAlive)).toEqual([]), {
      timeout: 30_000,
      interval: 100,
    });
  }, 70_000);
});
