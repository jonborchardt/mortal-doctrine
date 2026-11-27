// Verifies workspace dependency boundaries. See docs/architecture.md#layers.
// Runs directly under Node 24 type stripping: keep it dependency-free and erasable-syntax only.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join, relative } from 'node:path';

/** Lowest to highest. A package may depend only on packages at its own layer or below. */
export const LAYERS = [
  'foundation',
  'simulation',
  'animation',
  'presentation',
  'content',
  'application',
] as const;
export type Layer = (typeof LAYERS)[number];

/** Workspace roots (mirrors pnpm-workspace.yaml) and the layers each may contain. */
export const LOCATIONS: Record<string, { prefix: string; layers: readonly Layer[] }> = {
  packages: { prefix: '', layers: ['foundation', 'simulation', 'animation', 'presentation'] },
  characters: { prefix: 'character-', layers: ['content'] },
  arenas: { prefix: 'arena-', layers: ['content'] },
  apps: { prefix: '', layers: ['application'] },
};

const SCOPE = '@mortal-doctrine/';

export interface Manifest {
  name?: string;
  mortalDoctrine?: { layer?: string };
  exports?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export interface WorkspacePackage {
  /** e.g. `packages/simulation` (always forward slashes). */
  dir: string;
  manifest: Manifest;
  hasReadme: boolean;
  /** Bare import specifiers found in source files, with the file they appear in. */
  imports: readonly { specifier: string; file: string }[];
}

export function checkWorkspace(packages: readonly WorkspacePackage[]): string[] {
  const errors: string[] = [];
  const byName = new Map(packages.map((pkg) => [pkg.manifest.name, pkg]));
  const layerOf = (pkg: WorkspacePackage) => pkg.manifest.mortalDoctrine?.layer as Layer;

  for (const pkg of packages) {
    const [location = '', folder = ''] = pkg.dir.split('/');
    const rules = LOCATIONS[location];
    const fail = (message: string) => errors.push(`${pkg.dir}: ${message}`);
    if (!rules) {
      fail('is not inside a known workspace root');
      continue;
    }

    const expectedName = `${SCOPE}${rules.prefix}${folder}`;
    if (pkg.manifest.name !== expectedName) fail(`must be named "${expectedName}"`);

    const layer = layerOf(pkg);
    if (!rules.layers.includes(layer)) {
      fail(`"mortalDoctrine.layer" must be one of: ${rules.layers.join(', ')}`);
      continue;
    }
    if (layer !== 'application') {
      if (!pkg.manifest.exports) fail('must declare "exports" (its public entry points)');
      if (!pkg.hasReadme) fail('must have a README.md');
    }

    const declared = {
      ...pkg.manifest.peerDependencies,
      ...pkg.manifest.devDependencies,
      ...pkg.manifest.dependencies,
    };

    for (const [dep, range] of Object.entries(declared)) {
      if (!dep.startsWith(SCOPE)) continue;
      const target = byName.get(dep);
      if (!target) {
        fail(`depends on unknown workspace package ${dep}`);
        continue;
      }
      if (!range.startsWith('workspace:')) fail(`must reference ${dep} with "workspace:*"`);
      const targetLayer = layerOf(target);
      if (LAYERS.indexOf(targetLayer) > LAYERS.indexOf(layer)) {
        fail(`layer "${layer}" must not depend on ${dep} (layer "${targetLayer}")`);
      }
      if (layer === 'content' && targetLayer === 'content') {
        fail(`content packages must be independent; remove dependency on ${dep}`);
      }
    }

    for (const { specifier, file } of pkg.imports) {
      const name = packageName(specifier);
      if (!(name in declared))
        fail(`${file} imports "${name}" which is not declared in package.json`);
    }
  }

  errors.push(...findCycles(packages));
  return errors;
}

function findCycles(packages: readonly WorkspacePackage[]): string[] {
  const edges = new Map(
    packages.map((pkg) => [
      pkg.manifest.name ?? pkg.dir,
      Object.keys({ ...pkg.manifest.dependencies, ...pkg.manifest.devDependencies }).filter((dep) =>
        dep.startsWith(SCOPE),
      ),
    ]),
  );
  const errors: string[] = [];
  const done = new Set<string>();
  const visit = (name: string, path: string[]) => {
    if (path.includes(name)) {
      errors.push(`circular dependency: ${[...path.slice(path.indexOf(name)), name].join(' -> ')}`);
      return;
    }
    if (done.has(name)) return;
    for (const dep of edges.get(name) ?? []) visit(dep, [...path, name]);
    done.add(name);
  };
  for (const name of edges.keys()) visit(name, []);
  return errors;
}

/** `@scope/pkg/sub` -> `@scope/pkg`; `pkg/sub` -> `pkg`. */
export function packageName(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier);
}

const IMPORT_PATTERN =
  /\bimport\s+(?:type\s+)?[^'"]*?\bfrom\s*['"]([^'"]+)['"]|\bexport\s+[^'"]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\bimport\s+['"]([^'"]+)['"]/g;

/** Bare (non-relative, non-builtin) import specifiers in a source file. */
export function bareImports(source: string): string[] {
  const builtins = new Set(builtinModules);
  return [...source.matchAll(IMPORT_PATTERN)]
    .map((match) => match.slice(1).find(Boolean) ?? '')
    .filter(
      (spec) =>
        spec !== '' &&
        !spec.startsWith('.') &&
        !spec.startsWith('/') &&
        !spec.startsWith('node:') &&
        !builtins.has(spec),
    );
}

const SOURCE_FILE = /\.(ts|tsx|mts|js|mjs)$/;

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === 'node_modules' ? [] : sourceFiles(path);
    return SOURCE_FILE.test(entry) ? [path] : [];
  });
}

export function loadWorkspace(root: string): WorkspacePackage[] {
  return Object.keys(LOCATIONS).flatMap((location) => {
    const base = join(root, location);
    if (!existsSync(base)) return [];
    return readdirSync(base)
      .filter((folder) => existsSync(join(base, folder, 'package.json')))
      .map((folder) => {
        const dir = join(base, folder);
        const files = [
          ...sourceFiles(join(dir, 'src')),
          ...sourceFiles(join(dir, 'tests')),
          ...readdirSync(dir)
            .filter((f) => SOURCE_FILE.test(f))
            .map((f) => join(dir, f)),
        ];
        return {
          dir: `${location}/${folder}`,
          manifest: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Manifest,
          hasReadme: existsSync(join(dir, 'README.md')),
          imports: files.flatMap((file) =>
            bareImports(readFileSync(file, 'utf8')).map((specifier) => ({
              specifier,
              file: relative(dir, file).replaceAll('\\', '/'),
            })),
          ),
        };
      });
  });
}

if (import.meta.main) {
  const packages = loadWorkspace(process.cwd());
  const errors = checkWorkspace(packages);
  if (errors.length > 0) {
    console.error(`Dependency boundary violations (${errors.length}):`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log(`Dependency boundaries OK (${packages.length} workspace packages).`);
}
