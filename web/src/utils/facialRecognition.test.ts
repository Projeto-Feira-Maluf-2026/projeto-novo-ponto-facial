import { describe, expect, it } from 'vitest';

import { appendRecognitionEvidence, type TemporalEvidence } from './facialRecognition';

const evidence = (employeeId: string, capturedAt: number): TemporalEvidence => ({
  employeeId,
  capturedAt,
  image: `imagem-${capturedAt}`,
});

describe('appendRecognitionEvidence', () => {
  it('mantém três leituras válidas do mesmo funcionário', () => {
    const current = [evidence('func-1', 1_000), evidence('func-1', 2_000)];
    const result = appendRecognitionEvidence(current, evidence('func-1', 3_000), 10_000, 3);

    expect(result).toHaveLength(3);
  });

  it('não mistura leituras de funcionários diferentes', () => {
    const current = [evidence('func-1', 1_000), evidence('func-1', 2_000)];
    const result = appendRecognitionEvidence(current, evidence('func-2', 3_000), 10_000, 3);

    expect(result).toEqual([evidence('func-2', 3_000)]);
  });

  it('descarta apenas evidências realmente vencidas', () => {
    const current = [evidence('func-1', 1_000), evidence('func-1', 9_000)];
    const result = appendRecognitionEvidence(current, evidence('func-1', 12_000), 10_000, 3);

    expect(result.map((item) => item.capturedAt)).toEqual([9_000, 12_000]);
  });
});
