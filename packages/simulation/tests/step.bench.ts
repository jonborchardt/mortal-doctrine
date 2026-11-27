import { test } from 'vitest';
import { createInitialState } from '../src/index';
import { runFrames, walkCycleScript } from '../src/testing';

// Headless throughput baseline. Compare runs on the same machine only; never gate CI on it.
test('simulation step throughput', async ({ bench }) => {
  await bench('3600 frames (one minute of gameplay)', () => {
    runFrames(createInitialState(), walkCycleScript, 3600);
  }).run();
});
