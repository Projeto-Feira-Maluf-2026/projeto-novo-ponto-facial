import { beforeEach, describe, expect, it } from 'vitest';

import { readTerminalWorksiteId, saveTerminalWorksiteId } from './terminalPreferences';

describe('terminalPreferences', () => {
  beforeEach(() => window.localStorage.clear());

  it('compartilha a obra escolhida entre o terminal e o cadastro da apresentação', () => {
    saveTerminalWorksiteId('obra-feira');
    expect(readTerminalWorksiteId()).toBe('obra-feira');
  });

  it('remove a preferência quando a obra é limpa', () => {
    saveTerminalWorksiteId('obra-feira');
    saveTerminalWorksiteId('');
    expect(readTerminalWorksiteId()).toBe('');
  });
});
