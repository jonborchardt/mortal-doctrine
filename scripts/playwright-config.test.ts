import { describe, expect, it } from 'vitest';
import config from '../playwright.config';

// Importing the config binds and releases two ephemeral ports; nothing is started.
const scopes = [config, ...(config.projects ?? [])];

describe('playwright.config.ts', () => {
  // Ticket 0227: trace screencasts loaded slow Windows runners; see playwright.config.ts.
  it('keeps failure traces but records no screencast', () => {
    for (const scope of scopes) {
      expect(scope.use?.trace ?? config.use?.trace).toMatchObject({
        mode: 'retain-on-failure',
        screenshots: false,
      });
    }
  });

  it('does not loosen timeouts, retries or failure screenshots', () => {
    for (const scope of scopes) {
      expect(scope.timeout).toBeUndefined();
      expect(scope.expect?.timeout).toBeUndefined();
      expect(scope.retries ?? 0).toBe(0);
      expect(scope.use?.screenshot ?? config.use?.screenshot).toBe('only-on-failure');
    }
  });
});
