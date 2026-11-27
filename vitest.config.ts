import { defineConfig } from 'vitest/config';

// Root runner for `pnpm test`. Each workspace package can also run `vitest run` on its own.
export default defineConfig({
  test: {
    include: [
      '{packages,characters,arenas,apps}/*/tests/**/*.test.{ts,tsx}',
      'scripts/**/*.test.ts',
    ],
    benchmark: { include: ['{packages,characters,arenas}/*/tests/**/*.bench.ts'] },
    environment: 'node',
  },
});
