import { describe, expect, it } from 'vitest';

import {
  calculateFaceCropRegion,
  cameraAccessErrorMessage,
  faceBoxesFromLandmarks,
} from './CameraCapture';

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

describe('calculateFaceCropRegion', () => {
  it('separa rostos próximos para um recorte não incluir o centro do outro', () => {
    const leftFace = { x: 0.28, y: 0.25, width: 0.16, height: 0.3 };
    const rightFace = { x: 0.48, y: 0.24, width: 0.16, height: 0.3 };
    const crop = calculateFaceCropRegion(leftFace, 1280, 720, [rightFace], true);

    expect(crop).not.toBeNull();
    const otherCenterX = (rightFace.x + rightFace.width / 2) * 1280;
    const otherCenterY = (rightFace.y + rightFace.height * 0.46) * 720;
    const containsOtherCenter = otherCenterX >= crop!.sourceX
      && otherCenterX <= crop!.sourceX + crop!.side
      && otherCenterY >= crop!.sourceY
      && otherCenterY <= crop!.sourceY + crop!.side;

    expect(containsOtherCenter).toBe(false);
    expect(crop!.side).toBeGreaterThan(100);
  });

  it('mantém o recorte dentro dos limites do vídeo', () => {
    const crop = calculateFaceCropRegion(
      { x: 0.01, y: 0.02, width: 0.2, height: 0.35 },
      640,
      480,
    );

    expect(crop).not.toBeNull();
    expect(crop!.sourceX).toBe(0);
    expect(crop!.sourceY).toBe(0);
    expect(crop!.sourceX + crop!.side).toBeLessThanOrEqual(640);
    expect(crop!.sourceY + crop!.side).toBeLessThanOrEqual(480);
  });
});
