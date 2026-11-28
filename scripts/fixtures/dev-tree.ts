// Test fixture for scripts/dev.test.ts: a two-process tree standing in for `pnpm` → `vite`.
// With an argument it exits with that code; without one it starts a long-lived grandchild, prints
// its parent's, its own and the grandchild's PID and stays alive.
import { spawn } from 'node:child_process';

const exitCode = process.argv[2];
if (exitCode !== undefined) process.exit(Number(exitCode));

const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
  stdio: 'ignore',
});
// Like pnpm, pass SIGTERM down (Linux). On Windows a kill runs no handler: the launcher's job.
process.on('SIGTERM', () => {
  grandchild.kill('SIGTERM');
  process.exit(143);
});
console.log(`pids ${process.ppid} ${process.pid} ${grandchild.pid}`);
setInterval(() => {}, 1000);
