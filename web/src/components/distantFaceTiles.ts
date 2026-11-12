import type { Detection } from '@mediapipe/tasks-vision';

// O detector de rostos distantes (BlazeFace full range) trabalha numa entrada
// de 192 px. Num quadro 16:9 inteiro, um rosto a 4 m vira poucos pixels e some.
// Em passadas alternadas o detector olha só a faixa central do quadro, onde as
// pessoas ficam diante do terminal: o mesmo rosto chega ~1,7x maior ao modelo.
export type DetectionRegion = { x: number; y: number; width: number; height: number };

// Ciclo das passadas: quadro inteiro, faixa central e os quatro quadrantes
// (com sobreposição, para um rosto na divisa caber inteiro em um deles). No
// teste com 1000 fotos de grupo, os quadrantes fizeram o navegador ver 5 pontos
// a mais das pessoas cadastradas; um rosto pequeno chega ~2x maior ao modelo.
export const DISTANT_SCAN_CYCLE = 6;

export function distantScanRegion(pass: number, frameWidth: number, frameHeight: number): DetectionRegion {
  const step = ((pass % DISTANT_SCAN_CYCLE) + DISTANT_SCAN_CYCLE) % DISTANT_SCAN_CYCLE;
  if (step === 0) return { x: 0, y: 0, width: frameWidth, height: frameHeight };
  if (step === 1) {
    return {
      x: frameWidth * 0.2,
      y: frameHeight * 0.08,
      width: frameWidth * 0.6,
      height: frameHeight * 0.62,
    };
  }
  const quadrant = step - 2;
  return {
    x: quadrant % 2 === 0 ? 0 : frameWidth * 0.45,
    y: quadrant < 2 ? 0 : frameHeight * 0.4,
    width: frameWidth * 0.55,
    height: frameHeight * 0.6,
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
