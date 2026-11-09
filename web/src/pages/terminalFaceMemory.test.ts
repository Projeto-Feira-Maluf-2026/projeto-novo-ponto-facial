import { describe, expect, it } from 'vitest';

import {
  countDoneFaces,
  FACE_MEMORY_TTL_MS,
  faceNeedsRecognition,
  faceRetryDelay,
  refreshFaceMemory,
  rememberFaceOutcome,
} from './terminalFaceMemory';

const box = (x: number) => ({ x, y: 0.2, width: 0.2, height: 0.3 });

describe('memória de rostos do terminal', () => {
  it('segue quem já foi registrado enquanto a pessoa se mexe', () => {
    let memory = rememberFaceOutcome([], box(0.1), 'done', 0);
    // Pequenos passos a cada quadro: a caixa nunca perde a sobreposição.
    for (let step = 1; step <= 10; step += 1) {
      memory = refreshFaceMemory(memory, [box(0.1 + step * 0.03)], step * 80);
    }
    expect(faceNeedsRecognition(memory, box(0.4), 800)).toBe(false);
    expect(countDoneFaces(memory)).toBe(1);
  });

  it('esquece quem saiu do quadro: outra pessoa no mesmo lugar é reconhecida', () => {
    let memory = rememberFaceOutcome([], box(0.1), 'done', 0);
    memory = refreshFaceMemory(memory, [], FACE_MEMORY_TTL_MS + 1);
    expect(faceNeedsRecognition(memory, box(0.1), FACE_MEMORY_TTL_MS + 1)).toBe(true);
  });

  it('um rosto novo ao lado de um registrado vai ao servidor na hora', () => {
    const memory = rememberFaceOutcome([], box(0.1), 'done', 0);
    expect(faceNeedsRecognition(memory, box(0.6), 10)).toBe(true);
  });

  it('espera mais entre tentativas de um rosto que continua falhando', () => {
    let memory = rememberFaceOutcome([], box(0.1), 'failed', 0);
    expect(faceNeedsRecognition(memory, box(0.1), 100)).toBe(false);
    expect(faceNeedsRecognition(memory, box(0.1), 150)).toBe(true);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      memory = rememberFaceOutcome(memory, box(0.1), 'failed', 1_000);
    }
    expect(memory[0].failures).toBe(6);
    expect(faceNeedsRecognition(memory, box(0.1), 1_000 + faceRetryDelay(6) - 1)).toBe(false);
    expect(faceNeedsRecognition(memory, box(0.1), 1_000 + faceRetryDelay(6))).toBe(true);
  });

  it('uma falha posterior não desfaz um registro confirmado', () => {
    let memory = rememberFaceOutcome([], box(0.1), 'done', 0);
    memory = rememberFaceOutcome(memory, box(0.1), 'failed', 10);
    expect(countDoneFaces(memory)).toBe(1);
    expect(faceNeedsRecognition(memory, box(0.1), 5_000)).toBe(false);
  });
});
