import { describe, expect, it } from 'vitest';
import { buildLabIndex, findLab, type LabDefinition } from '../src/lab-registry';

const Component = () => null;

function labModule(id: string, overrides: Partial<LabDefinition> = {}) {
  const lab: LabDefinition = {
    id,
    name: `${id} lab`,
    description: 'test lab',
    route: `/labs/${id}`,
    category: 'Simulation',
    component: Component,
    ...overrides,
  };
  return { [`./${id}/lab.ts`]: { lab } };
}

describe('buildLabIndex', () => {
  it('lists discovered labs and replaces planned entries with the same id', () => {
    const index = buildLabIndex({ ...labModule('input') }, [
      { id: 'input', name: 'Input Lab', category: 'Simulation' },
      { id: 'audio', name: 'Audio Lab', category: 'Presentation' },
    ]);
    expect(index.map((entry) => [entry.lab.id, entry.status])).toEqual([
      ['input', 'available'],
      ['audio', 'planned'],
    ]);
  });

  it('finds labs by route, tolerating a trailing slash', () => {
    const index = buildLabIndex(labModule('input'), []);
    expect(findLab(index, '/labs/input/')?.id).toBe('input');
    expect(findLab(index, '/labs/missing')).toBeNull();
  });

  it('rejects labs that break the convention', () => {
    expect(() => buildLabIndex({ './input/lab.ts': {} }, [])).toThrow(/must export `lab`/);
    expect(() => buildLabIndex(labModule('input', { id: 'other' }), [])).toThrow(/folder name/);
    expect(() => buildLabIndex(labModule('input', { route: '/input' }), [])).toThrow(/route/);
    expect(() =>
      buildLabIndex(labModule('input', { category: 'Misc' as LabDefinition['category'] }), []),
    ).toThrow(/category/);
  });
});
