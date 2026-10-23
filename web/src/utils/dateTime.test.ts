import { describe, expect, it } from 'vitest';

import { parseApiDate } from './dateTime';

describe('parseApiDate', () => {
  it('interpreta timestamp sem fuso da API como UTC', () => {
    expect(parseApiDate('2026-08-26T01:14:00').toISOString()).toBe('2026-08-26T01:14:00.000Z');
  });

  it('preserva timestamps que já possuem fuso', () => {
    expect(parseApiDate('2026-08-25T22:14:00-03:00').toISOString()).toBe('2026-08-26T01:14:00.000Z');
  });
});
