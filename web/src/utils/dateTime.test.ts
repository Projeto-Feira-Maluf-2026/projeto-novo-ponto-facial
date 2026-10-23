import { describe, expect, it } from 'vitest';

import {
  appDateInput,
  appDayBoundaryIso,
  formatInAppTimeZone,
  parseApiDate,
  shiftDateInput,
} from './dateTime';

describe('parseApiDate', () => {
  it('interpreta timestamp sem fuso da API como UTC', () => {
    expect(parseApiDate('2026-08-26T01:14:00').toISOString()).toBe('2026-08-26T01:14:00.000Z');
  });

  it('preserva timestamps que já possuem fuso', () => {
    expect(parseApiDate('2026-08-25T22:14:00-03:00').toISOString()).toBe('2026-08-26T01:14:00.000Z');
  });
});

describe('horário de São Paulo independente do aparelho', () => {
  it('exibe a batida de 01:14 UTC como 22:14 do dia anterior', () => {
    const punch = parseApiDate('2026-08-26T01:14:00Z');
    expect(formatInAppTimeZone(punch, { hour: '2-digit', minute: '2-digit' })).toBe('22:14');
    expect(appDateInput(punch)).toBe('2026-08-25');
  });

  it('converte o dia do relatório em limites UTC de São Paulo', () => {
    expect(appDayBoundaryIso('2026-10-01')).toBe('2026-10-01T03:00:00.000Z');
    expect(appDayBoundaryIso('2026-10-31', true)).toBe('2026-11-01T02:59:59.999Z');
  });

  it('usa a base de fusos para datas com horário de verão histórico', () => {
    // São Paulo used UTC-2 on 2018-12-15.
    expect(appDayBoundaryIso('2018-12-15')).toBe('2018-12-15T02:00:00.000Z');
    // 2018-11-04 started at 01:00 (midnight skipped); 2019-02-16 repeated 23:00–23:59.
    expect(appDayBoundaryIso('2018-11-04')).toBe('2018-11-04T03:00:00.000Z');
    expect(appDayBoundaryIso('2019-02-16', true)).toBe('2019-02-17T02:59:59.999Z');
  });

  it('desloca datas de calendário atravessando mês e ano', () => {
    expect(shiftDateInput('2026-03-01', -6)).toBe('2026-02-23');
    expect(shiftDateInput('2026-12-29', 6)).toBe('2027-01-04');
  });
});
