import { describe, expect, it } from 'vitest';

import { cameraAccessErrorMessage, faceBoxesFromLandmarks } from './CameraCapture';

describe('cameraAccessErrorMessage', () => {
  it('orienta a liberar a permissão quando o navegador bloqueia a câmera', () => {
    expect(cameraAccessErrorMessage({ name: 'NotAllowedError' })).toContain('cadeado');
  });

  it('diferencia webcam ausente de webcam ocupada', () => {
    expect(cameraAccessErrorMessage({ name: 'NotFoundError' })).toContain('Nenhuma webcam');
    expect(cameraAccessErrorMessage({ name: 'NotReadableError' })).toContain('ocupada');
  });

  it('explica quando o acesso exige HTTPS', () => {
    expect(cameraAccessErrorMessage({ name: 'SecurityError' })).toContain('HTTPS');
  });
});

describe('faceBoxesFromLandmarks', () => {
  it('mantém um enquadramento independente para cada rosto', () => {
    const boxes = faceBoxesFromLandmarks([
      [{ x: 0.1, y: 0.2, z: 0, visibility: 1 }, { x: 0.3, y: 0.5, z: 0, visibility: 1 }],
      [{ x: 0.6, y: 0.1, z: 0, visibility: 1 }, { x: 0.9, y: 0.45, z: 0, visibility: 1 }],
    ]);

    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toMatchObject({ x: 0.1, y: 0.2 });
    expect(boxes[0].width).toBeCloseTo(0.2);
    expect(boxes[0].height).toBeCloseTo(0.3);
    expect(boxes[1]).toMatchObject({ x: 0.6, y: 0.1 });
    expect(boxes[1].width).toBeCloseTo(0.3);
    expect(boxes[1].height).toBeCloseTo(0.35);
  });

  it('limita a leitura simultânea sem misturar os rostos', () => {
    const faces = Array.from({ length: 7 }, (_, index) => [
      { x: index / 10, y: 0.2, z: 0, visibility: 1 },
      { x: index / 10 + 0.05, y: 0.3, z: 0, visibility: 1 },
    ]);

    expect(faceBoxesFromLandmarks(faces)).toHaveLength(5);
  });
});
