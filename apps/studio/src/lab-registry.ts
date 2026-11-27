import type { ComponentType } from 'react';

export const LAB_CATEGORIES = [
  'Simulation',
  'Animation',
  'Presentation',
  'Content',
  'Analysis',
] as const;
export type LabCategory = (typeof LAB_CATEGORIES)[number];

/** What every `src/labs/<id>/lab.ts` exports as `lab`. */
export interface LabDefinition {
  /** Kebab-case; must equal the lab's folder name. */
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Stable, directly loadable URL path: `/labs/<id>`. */
  readonly route: string;
  readonly category: LabCategory;
  /** Usually `lazy(() => import('./XLab'))` so labs load independently. */
  readonly component: ComponentType;
}

export interface PlannedLab {
  readonly id: string;
  readonly name: string;
  readonly category: LabCategory;
}

export type LabEntry =
  | { readonly status: 'available'; readonly lab: LabDefinition }
  | { readonly status: 'planned'; readonly lab: PlannedLab };

const MODULE_PATH = /^\.\/([^/]+)\/lab\.ts$/;
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Builds navigation from discovered lab modules (keyed by `./<id>/lab.ts`) plus roadmap
 * placeholders. An implemented lab supersedes a planned entry with the same id, so adding a
 * lab never requires editing a central list. Throws on malformed or conflicting labs.
 */
export function buildLabIndex(
  modules: Record<string, unknown>,
  planned: readonly PlannedLab[],
): LabEntry[] {
  // Folder names are unique and route must equal `/labs/<folder>`, so routes are unique too.
  const available = Object.entries(modules).map(([path, module]) => validateLab(path, module));
  const ids = new Set(available.map((lab) => lab.id));
  const entries: LabEntry[] = [
    ...available.map((lab) => ({ status: 'available' as const, lab })),
    ...planned
      .filter((lab) => !ids.has(lab.id))
      .map((lab) => ({ status: 'planned' as const, lab })),
  ];
  const order = (entry: LabEntry) => LAB_CATEGORIES.indexOf(entry.lab.category);
  return entries.sort((a, b) => order(a) - order(b) || a.lab.name.localeCompare(b.lab.name));
}

export function findLab(entries: readonly LabEntry[], pathname: string): LabDefinition | null {
  const path = pathname.replace(/\/+$/, '');
  for (const entry of entries) {
    if (entry.status === 'available' && entry.lab.route === path) return entry.lab;
  }
  return null;
}

function validateLab(path: string, module: unknown): LabDefinition {
  const folder = MODULE_PATH.exec(path)?.[1];
  const lab = (module as { lab?: Partial<LabDefinition> } | null)?.lab;
  const fail = (problem: string): never => {
    throw new Error(`Invalid lab module ${path}: ${problem}`);
  };
  if (!folder) return fail('expected path ./<id>/lab.ts');
  if (!lab) return fail('must export `lab`');
  if (!lab.id || !ID.test(lab.id)) fail('`id` must be kebab-case');
  if (lab.id !== folder) fail(`\`id\` must match folder name "${folder}"`);
  if (lab.route !== `/labs/${folder}`) fail(`\`route\` must be "/labs/${folder}"`);
  if (!lab.name || !lab.description) fail('`name` and `description` are required');
  if (!lab.category || !LAB_CATEGORIES.includes(lab.category)) fail('unknown `category`');
  if (!lab.component) fail('`component` is required');
  return lab as LabDefinition;
}
