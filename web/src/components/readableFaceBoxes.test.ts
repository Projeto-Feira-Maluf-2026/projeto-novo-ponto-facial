import { describe, expect, it } from 'vitest';

import { readableFaceBoxes } from './CameraCapture';

describe('rostos legíveis', () => {
  const near = { x: 0.3, y: 0.2, width: 0.12, height: 0.22 };
  const background = { x: 0.7, y: 0.3, width: 0.04, height: 0.06 };

  it('ignora quem passa ao fundo', () => {
    expect(readableFaceBoxes([near, background], 0.1)).toEqual([near]);
  });

  it('sem limite, mantém todos (cadastro usa assim)', () => {
    expect(readableFaceBoxes([near, background], 0)).toEqual([near, background]);
  });
});
