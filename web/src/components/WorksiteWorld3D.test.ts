import { describe, expect, it } from 'vitest';

import { ARCHETYPE_LABELS, pickArchetype } from './WorksiteWorld3D';

describe('pickArchetype', () => {
  it('reads the kind of construction from the worksite name', () => {
    expect(pickArchetype({ name: 'Reforma Centro', code: 'CENTRO' }, 0)).toBe('retrofit');
    expect(pickArchetype({ name: 'Canteiro CIC', code: 'CIC' }, 0)).toBe('warehouse');
    expect(pickArchetype({ name: 'Condomínio Jardim', code: 'JARD' }, 0)).toBe('houses');
    expect(pickArchetype({ name: 'Torre Norte', code: 'TN' }, 0)).toBe('tower');
    expect(pickArchetype({ name: 'Centro Comercial', code: 'CC' }, 0)).toBe('office');
  });

  it('gives every model a stable choice and reaches all five without a hint in the name', () => {
    const picks = [0, 1, 2, 3, 4].map((seed) => pickArchetype({ name: 'Obra Batel', code: 'BATEL' }, seed));
    expect(new Set(picks).size).toBe(5);
    expect(pickArchetype({ name: 'Obra Batel', code: 'BATEL' }, 7)).toBe(pickArchetype({ name: 'Obra Batel', code: 'BATEL' }, 7));
    picks.forEach((archetype) => expect(ARCHETYPE_LABELS[archetype]).toBeTruthy());
  });
});
