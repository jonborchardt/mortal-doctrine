import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';
import {
  bareImports,
  checkWorkspace,
  determinismLintConfig,
  loadWorkspace,
  parseJsonc,
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
    tsconfig: { compilerOptions: {} },
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

describe('determinism rules by layer', () => {
  // In-memory fixtures: a real package.json under packages/ would join the pnpm workspace.
  const simulationFixture = pkg('packages/new-sim', 'simulation');
  const presentationFixture = pkg('packages/new-view', 'presentation');
  const config = determinismLintConfig([simulationFixture, presentationFixture], []);

  it('covers packages declared foundation, simulation or animation and nothing else', () => {
    const config = determinismLintConfig(
      [
        pkg('packages/a', 'foundation'),
        simulationFixture,
        pkg('packages/c', 'animation'),
        presentationFixture,
        pkg('characters/monk', 'content'),
        pkg('apps/game', 'application'),
      ],
      [],
    );
    expect(config.files).toEqual(['packages/a/**', 'packages/new-sim/**', 'packages/c/**']);
  });

  it('forbids clocks, Math.random, pixi.js, React and node: imports in a new simulation package', () => {
    const source = [
      "import { Application } from 'pixi.js';",
      "import { useState } from 'react';",
      "import { createRoot } from 'react-dom/client';",
      "import { readFileSync } from 'node:fs';",
      'export const t = Date.now() + performance.now() + Math.random();',
      'export const used = [Application, useState, createRoot, readFileSync];',
    ].join('\n');
    const lint = (filename: string) =>
      new Linter({ cwd: '/repo' }).verify(
        source,
        [{ languageOptions: { sourceType: 'module' } }, config],
        { filename: `/repo/${filename}` },
      );

    const messages = lint('packages/new-sim/src/index.js');
    expect(messages.map((m) => `${m.line}:${m.ruleId ?? ''}`)).toEqual([
      '1:no-restricted-imports',
      '2:no-restricted-imports',
      '3:no-restricted-imports',
      '4:no-restricted-imports',
      '5:no-restricted-globals',
      '5:no-restricted-globals',
      '5:no-restricted-properties',
    ]);
    expect(lint('packages/new-view/src/index.js')).toEqual([]);
  });

  it('reports a DOM lib or ambient types in a deterministic package tsconfig', () => {
    const domLib = pkg('packages/new-sim', 'simulation');
    domLib.tsconfig = { compilerOptions: { lib: ['ES2023', 'DOM'] } };
    const types = pkg('packages/new-anim', 'animation');
    types.tsconfig = { compilerOptions: { types: ['node'] } };
    const missing = pkg('packages/new-core', 'foundation');
    missing.tsconfig = undefined;
    const presentation = pkg('packages/new-view', 'presentation');
    presentation.tsconfig = { compilerOptions: { lib: ['ES2023', 'DOM'], types: ['node'] } };
    expect(checkWorkspace([domLib, types, missing, presentation])).toEqual([
      'packages/new-sim: layer "simulation" must not include a DOM lib in tsconfig.json',
      'packages/new-anim: layer "animation" must not declare ambient "types" in tsconfig.json',
      'packages/new-core: layer "foundation" must have a tsconfig.json',
    ]);
  });

  it('derives coverage of the real workspace from package.json layers', () => {
    const workspace = loadWorkspace(process.cwd());
    const { files } = determinismLintConfig(workspace, []);
    expect(files).toContain('packages/sim-core/**');
    expect(files).toContain('packages/simulation/**');
    expect(files).not.toContain('packages/renderer/**');
    expect(workspace.find((p) => p.dir === 'packages/simulation')?.tsconfig).toEqual({
      extends: '../../tsconfig.base.json',
      include: ['src', 'tests'],
    });
  });
});

describe('parseJsonc', () => {
  it('accepts comments and trailing commas without touching strings', () => {
    const text = `{
      // line comment
      "url": "http://example.test/*not a comment*/",
      /* block */ "list": ["a,]", "b",],
    }`;
    expect(parseJsonc(text)).toEqual({
      url: 'http://example.test/*not a comment*/',
      list: ['a,]', 'b'],
    });
  });
});
