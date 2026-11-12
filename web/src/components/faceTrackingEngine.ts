import { FaceDetector, FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { FaceTrackingFrame, FaceTrackingRequest, FaceTrackingResponse } from './faceTrackingProtocol';
import { distantScanRegion, mapRegionDetection } from './distantFaceTiles';

// Detector leve (BlazeFace ~5 a 15 ms): a cada 120 ms ele olha uma região do ciclo.
const DISTANT_SCAN_INTERVAL_MS = 120;

type Canvas2D = OffscreenCanvas | HTMLCanvasElement;

function frameSize(frame: FaceTrackingFrame) {
  if ('videoWidth' in frame) return { width: frame.videoWidth, height: frame.videoHeight };
  return { width: frame.width, height: frame.height };
}

function createCanvas(width: number, height: number): Canvas2D {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * O rastreamento de rostos, igual no worker e na thread principal. O terminal
 * usa o worker; quando o navegador não consegue rodá-lo (Safari do iPhone com
 * MediaPipe em worker, por exemplo), a câmera usa este mesmo motor na página.
 *
 * `moduleLoader`: num worker de módulo não existe importScripts, então o WASM
 * vem pelo carregador ESM; na página, o carregador clássico é o mais compatível.
 */
export function createFaceTrackingEngine(
  post: (message: FaceTrackingResponse) => void,
  moduleLoader: boolean,
) {
  let landmarker: FaceLandmarker | null = null;
  let detector: FaceDetector | null = null;
  let lastDistantScan = 0;
  let distantPass = 0;

  const init = async (data: Extract<FaceTrackingRequest, { type: 'init' }>) => {
    try {
      const vision = await FilesetResolver.forVisionTasks(data.wasmUrl, moduleLoader);
      landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: data.landmarkerUrl, delegate: 'CPU' },
        runningMode: 'VIDEO', numFaces: 5,
        minFaceDetectionConfidence: 0.48, minFacePresenceConfidence: 0.48,
        minTrackingConfidence: 0.42,
        outputFaceBlendshapes: false, outputFacialTransformationMatrixes: false,
      });
      try {
        detector = await FaceDetector.createFromOptions(vision, {
          baseOptions: { modelAssetPath: data.detectorUrl, delegate: 'CPU' },
          runningMode: 'IMAGE', minDetectionConfidence: 0.48, minSuppressionThreshold: 0.35,
        });
      } catch {
        // The distant detector is optional; landmark tracking remains available.
        detector = null;
      }
      post({ type: 'ready' });
    } catch {
      post({ type: 'error' });
    }
  };

  const track = (frame: FaceTrackingFrame, timestamp: number) => {
    if (!landmarker) throw new Error('not_ready');
    const result = landmarker.detectForVideo(frame, timestamp);
    const size = frameSize(frame);
    let detections;
    let { width, height } = size;
    if (detector && timestamp - lastDistantScan >= DISTANT_SCAN_INTERVAL_MS) {
      lastDistantScan = timestamp;
      const scale = Math.min(1, 640 / Math.max(width, height));
      const region = distantScanRegion(distantPass, size.width, size.height);
      distantPass += 1;
      width = Math.max(1, Math.round(size.width * scale));
      height = Math.max(1, Math.round(size.height * scale));
      const canvasWidth = Math.max(1, Math.round(region.width * scale));
      const canvasHeight = Math.max(1, Math.round(region.height * scale));
      const canvas = createCanvas(canvasWidth, canvasHeight);
      (canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null)?.drawImage(
        frame, region.x, region.y, region.width, region.height, 0, 0, canvasWidth, canvasHeight,
      );
      detections = detector.detect(canvas).detections.map((detection) => mapRegionDetection(
        detection, region, scale, canvasWidth, canvasHeight, width, height,
      ));
    }
    return { result, detections, width, height };
  };

  return {
    async handle(data: FaceTrackingRequest) {
      if (data.type === 'init') {
        await init(data);
        return;
      }
      if (data.type !== 'frame') return;
      try {
        post({ type: 'result', ...track(data.frame, data.timestamp), timestamp: data.timestamp });
      } catch {
        post({ type: 'error' });
      } finally {
        if ('close' in data.frame) data.frame.close();
      }
    },
    close() {
      landmarker?.close();
      detector?.close();
      landmarker = null;
      detector = null;
    },
  };
}
