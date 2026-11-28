import { createServer } from 'node:net';
import { availableParallelism } from 'node:os';
import { defineConfig, devices } from '@playwright/test';

// Worktree isolation: every run starts its own dev servers on free ports and never reuses an
// existing server, so parallel checkouts cannot test each other's code. Ports are chosen once
// in the runner process and inherited by workers (which re-evaluate this file) via env.
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() =>
        typeof address === 'object' && address ? resolve(address.port) : reject(new Error()),
      );
    });
  });
}

process.env.MD_E2E_GAME_PORT ??= String(await freePort());
process.env.MD_E2E_STUDIO_PORT ??= String(await freePort());

const apps = [
  { name: 'game', port: process.env.MD_E2E_GAME_PORT },
  { name: 'studio', port: process.env.MD_E2E_STUDIO_PORT },
];
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  // Every worker is a Chromium rendering WebGL in software (SwiftShader) at 60 fps. Measured on
  // 12 threads: 6 workers (the default, half the cores) ran the suite slower than 3 and starved
  // tests until 5 s assertions timed out. More than 3 only adds contention.
  workers: Math.max(1, Math.min(3, Math.floor(availableParallelism() / 2))),
  forbidOnly: isCI,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    // No trace screencast: the Pixi labs redraw every display frame, so it never idles, and each
    // frame is a SwiftShader readback, a JPEG encode and a file write in every worker. That load
    // starved slow Windows runners until tests timed out. Failure traces keep DOM snapshots,
    // network, console and sources; rerun with `--trace on` for a film strip.
    trace: { mode: 'retain-on-failure', screenshots: false },
    screenshot: 'only-on-failure',
  },
  projects: apps.map(({ name, port }) => ({
    name,
    testMatch: `${name}*.spec.ts`,
    use: {
      ...devices['Desktop Chrome'],
      baseURL: `http://127.0.0.1:${port}`,
      // GPU-less CI runners need SwiftShader for WebGL, which PixiJS requires.
      launchOptions: { args: ['--enable-unsafe-swiftshader'] },
    },
  })),
  webServer: apps.map(({ name, port }) => ({
    command: `pnpm --filter @mortal-doctrine/${name} exec vite --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  })),
});
