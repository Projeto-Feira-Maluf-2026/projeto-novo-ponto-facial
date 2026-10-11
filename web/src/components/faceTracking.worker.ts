import { FaceDetector, FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { FaceTrackingRequest, FaceTrackingResponse } from './faceTrackingProtocol';

// No camera frames leave this worker. Only transient landmarks/boxes are returned.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<FaceTrackingRequest>) => void) | null;
  postMessage: (message: FaceTrackingResponse) => void;
};
let landmarker: FaceLandmarker | null = null;
let detector: FaceDetector | null = null;
let lastDistantScan = 0;
scope.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try {
      // Module workers cannot use importScripts: request the ESM WASM loader.
      const vision = await FilesetResolver.forVisionTasks(data.wasmUrl, true);
      // OffscreenCanvas CPU execution avoids requiring a document/GPU context.
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
        // The existing distant detector is optional; landmark tracking remains available.
        detector = null;
      }
      scope.postMessage({ type: 'ready' });
    } catch {
      scope.postMessage({ type: 'error' });
    }
    return;
  }
  if (data.type !== 'frame') return;
  const frame = data.frame as ImageBitmap;
  try {
    if (!landmarker) throw new Error('not_ready');
    const result = landmarker.detectForVideo(frame, data.timestamp);
    let detections;
    let width = frame.width;
    let height = frame.height;
    if (detector && data.timestamp - lastDistantScan >= 180) {
      lastDistantScan = data.timestamp;
      const scale = Math.min(1, 640 / Math.max(width, height));
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
      const canvas = new OffscreenCanvas(width, height);
      canvas.getContext('2d')?.drawImage(frame, 0, 0, width, height);
      detections = detector.detect(canvas).detections;
    }
    scope.postMessage({ type: 'result', result, detections, width, height, timestamp: data.timestamp });
  } catch {
    scope.postMessage({ type: 'error' });
  } finally {
    frame.close();
  }
};
