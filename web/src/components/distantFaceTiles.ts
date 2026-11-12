import type { Detection } from '@mediapipe/tasks-vision';

// O detector de rostos distantes (BlazeFace full range) trabalha numa entrada
// de 192 px. Num quadro 16:9 inteiro, um rosto a 4 m vira poucos pixels e some.
// Em passadas alternadas o detector olha só a faixa central do quadro, onde as
// pessoas ficam diante do terminal: o mesmo rosto chega ~1,7x maior ao modelo.
export type DetectionRegion = { x: number; y: number; width: number; height: number };

export function distantScanRegion(pass: number, frameWidth: number, frameHeight: number): DetectionRegion {
  if (pass % 2 === 0) return { x: 0, y: 0, width: frameWidth, height: frameHeight };
  return {
    x: frameWidth * 0.2,
    y: frameHeight * 0.08,
    width: frameWidth * 0.6,
    height: frameHeight * 0.62,
  };
}

/**
 * Leva uma detecção feita num recorte (em pixels do recorte reduzido por
 * `scale`) para pixels do quadro inteiro reduzido pelo mesmo `scale`, que é o
 * espaço em que a página interpreta caixas e pontos.
 */
export function mapRegionDetection(
  detection: Detection,
  region: DetectionRegion,
  scale: number,
  canvasWidth: number,
  canvasHeight: number,
  outputWidth: number,
  outputHeight: number,
): Detection {
  const offsetX = region.x * scale;
  const offsetY = region.y * scale;
  const box = detection.boundingBox;
  return {
    ...detection,
    boundingBox: box && {
      ...box,
      originX: box.originX + offsetX,
      originY: box.originY + offsetY,
    },
    keypoints: detection.keypoints.map((point) => ({
      ...point,
      x: (point.x * canvasWidth + offsetX) / outputWidth,
      y: (point.y * canvasHeight + offsetY) / outputHeight,
    })),
  };
}
