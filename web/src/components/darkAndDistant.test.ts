import { describe, expect, it } from 'vitest';
import type { Detection } from '@mediapipe/tasks-vision';
import {
  faceLightFromPixels,
  lowLightExposureConstraints,
  updateDistantFaceCandidates,
} from './CameraCapture';
import { distantScanRegion, mapRegionDetection } from './distantFaceTiles';

const pixels = (values: number[]) => new Uint8ClampedArray(values.flatMap((value) => [value, value, value, 255]));

describe('luz do rosto', () => {
  it('mede a mediana, sem se deixar levar pelo fundo estourado', () => {
    expect(faceLightFromPixels(pixels([40, 40, 40, 255, 255]))).toBeCloseTo(40 / 255);
  });
});

describe('exposição em contraluz', () => {
  const track = (settings: object, capabilities: object) => ({
    getSettings: () => settings as MediaTrackSettings,
    getCapabilities: () => capabilities as MediaTrackCapabilities,
  });

  it('sobe a compensação e depois volta ao valor original', () => {
    const base = { current: null as number | null };
    const camera = track({ exposureCompensation: 0 }, { exposureCompensation: { min: -2, max: 2 } });
    expect(lowLightExposureConstraints(camera, true, base)).toEqual({ advanced: [{ exposureCompensation: 1 }] });
    expect(lowLightExposureConstraints(camera, false, base)).toEqual({ advanced: [{ exposureCompensation: 0 }] });
  });

  it('não faz nada em câmera sem esse controle', () => {
    expect(lowLightExposureConstraints(track({}, {}), true, { current: null })).toBeNull();
  });
});

describe('rostos distantes', () => {
  it('percorre quadro inteiro, faixa central e quatro quadrantes sobrepostos', () => {
    const regions = Array.from({ length: 7 }, (_, pass) => distantScanRegion(pass, 1000, 1000));
    expect(regions[0]).toEqual({ x: 0, y: 0, width: 1000, height: 1000 });
    expect(regions.slice(2, 6)).toEqual([
      { x: 0, y: 0, width: 550, height: 600 },
      { x: 450, y: 0, width: 550, height: 600 },
      { x: 0, y: 400, width: 550, height: 600 },
      { x: 450, y: 400, width: 550, height: 600 },
    ]);
    expect(regions[6]).toEqual(regions[0]);
  });

  it('a passada da faixa central devolve caixa e pontos no quadro inteiro', () => {
    const region = distantScanRegion(1, 1920, 1080);
    const scale = 640 / 1920;
    const canvasWidth = Math.round(region.width * scale);
    const canvasHeight = Math.round(region.height * scale);
    const detection = {
      categories: [{ score: 0.9, index: 0, categoryName: '', displayName: '' }],
      boundingBox: { originX: 100, originY: 50, width: 20, height: 24, angle: 0 },
      keypoints: [{ x: 0.5, y: 0.5 }],
    } as Detection;
    const mapped = mapRegionDetection(detection, region, scale, canvasWidth, canvasHeight, 640, 360);
    expect(mapped.boundingBox?.originX).toBeCloseTo(100 + 1920 * 0.2 * scale);
    expect(mapped.boundingBox?.originY).toBeCloseTo(50 + 1080 * 0.08 * scale);
    expect(mapped.keypoints[0].x).toBeCloseTo((0.5 * canvasWidth + 1920 * 0.2 * scale) / 640);
  });

  it('um rosto visto só numa das passadas continua até expirar', () => {
    const far = { x: 0.45, y: 0.3, width: 0.04, height: 0.07 };
    const near = { x: 0.1, y: 0.2, width: 0.1, height: 0.18 };
    const first = updateDistantFaceCandidates([], [far], 0, 450);
    const second = updateDistantFaceCandidates(first, [near], 200, 450);
    expect(second.map((candidate) => candidate.box)).toEqual(expect.arrayContaining([far, near]));
    expect(updateDistantFaceCandidates(second, [near], 500, 450)).toHaveLength(1);
  });
});
