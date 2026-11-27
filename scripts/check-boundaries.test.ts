import { describe, expect, it } from 'vitest';
import {
  bareImports,
  checkWorkspace,
  type Manifest,
  type WorkspacePackage,
} from './check-boundaries';

function pkg(
  dir: string,
  layer: string,
  deps: Record<string, string> = {},
  imports: string[] = [],
): WorkspacePackage {
  const [location, folder] = dir.split('/');
  const prefix = location === 'characters' ? 'character-' : location === 'arenas' ? 'arena-' : '';
  const manifest: Manifest = {
    name: `@mortal-doctrine/${prefix}${folder}`,
    mortalDoctrine: { layer },
    exports: { '.': './src/index.ts' },
    dependencies: deps,
  };
  return {
    dir,
    manifest,
    hasReadme: true,
    imports: imports.map((specifier) => ({ specifier, file: 'src/index.ts' })),
  };
}

describe('checkWorkspace', () => {
  it('accepts downward dependencies with declared imports', () => {
    const errors = checkWorkspace([
      pkg('packages/math', 'foundation'),
      pkg('packages/sim', 'simulation', { '@mortal-doctrine/math': 'workspace:*' }, [
        '@mortal-doctrine/math',
      ]),
      pkg('apps/game', 'application', { '@mortal-doctrine/sim': 'workspace:*' }),
    ]);
    expect(errors).toEqual([]);
  });

  it('rejects upward dependencies', () => {
    const errors = checkWorkspace([
      pkg('packages/render', 'presentation'),
      pkg('packages/sim', 'simulation', { '@mortal-doctrine/render': 'workspace:*' }),
    ]);
    expect(errors).toEqual([
      'packages/sim: layer "simulation" must not depend on @mortal-doctrine/render (layer "presentation")',
    ]);
  });

  it('rejects cycles', () => {
    const errors = checkWorkspace([
      pkg('packages/a', 'simulation', { '@mortal-doctrine/b': 'workspace:*' }),
      pkg('packages/b', 'simulation', { '@mortal-doctrine/a': 'workspace:*' }),
    ]);
    expect(errors).toEqual([
      'circular dependency: @mortal-doctrine/a -> @mortal-doctrine/b -> @mortal-doctrine/a',
    ]);
  });

  it('rejects engine packages depending on characters and characters depending on each other', () => {
    const errors = checkWorkspace([
      pkg('characters/monk', 'content'),
      pkg('characters/oracle', 'content', { '@mortal-doctrine/character-monk': 'workspace:*' }),
      pkg('packages/combat', 'simulation', { '@mortal-doctrine/character-monk': 'workspace:*' }),
    ]);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('content packages must be independent');
    expect(errors[1]).toContain('must not depend on @mortal-doctrine/character-monk');
  });

  it('rejects undeclared imports, non-workspace ranges, bad names and wrong locations', () => {
    const misnamed = pkg('packages/sim', 'simulation');
    misnamed.manifest.name = '@mortal-doctrine/simulation-core';
    const errors = checkWorkspace([
      pkg('packages/math', 'foundation', {}, ['zod/mini']),
      pkg('packages/sim', 'simulation', { '@mortal-doctrine/math': '^0.0.0' }),
      pkg('characters/monk', 'simulation'),
      misnamed,
    ]);
    expect(errors).toEqual([
      'packages/math: src/index.ts imports "zod" which is not declared in package.json',
      'packages/sim: must reference @mortal-doctrine/math with "workspace:*"',
      'characters/monk: "mortalDoctrine.layer" must be one of: content',
      'packages/sim: must be named "@mortal-doctrine/sim"',
    ]);
  });
});

describe('bareImports', () => {
  it('extracts package specifiers and ignores relative and builtin imports', () => {
    const source = `
      import { a } from './local';
      import type { B } from '@scope/pkg/sub';
      import {
        c,
      } from "react";
      export { d } from 'zod';
      import 'side-effect';
      const e = await import('pixi.js');
      import fs from 'node:fs';
      import path from 'path';
    `;
    expect(bareImports(source)).toEqual([
      '@scope/pkg/sub',
      'react',
      'zod',
      'side-effect',
      'pixi.js',
    ]);
  });
});
