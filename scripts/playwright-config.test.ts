import { describe, expect, it } from 'vitest';
import config from '../playwright.config';

// Importing the config binds and releases two ephemeral ports; nothing is started.
const scopes = [config, ...(config.projects ?? [])];

describe('playwright.config.ts', () => {
  // Every Pixi lab redraws its canvas each display frame, so a trace screencast never idles: each
  // frame is a software-WebGL readback, a JPEG encode and a file write in every worker. On slow
  // Windows runners that load starved the browsers until tests timed out (ticket 0227).
  it('keeps failure traces but records no screencast', () => {
    expect(config.use?.trace).toMatchObject({ mode: 'retain-on-failure', screenshots: false });
    for (const project of config.projects ?? []) {
      expect(project.use?.trace ?? config.use?.trace).toMatchObject({
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
      expect(scope.use?.screenshot ?? 'only-on-failure').toBe('only-on-failure');
    }
    expect(config.use?.screenshot).toBe('only-on-failure');
  });
});
