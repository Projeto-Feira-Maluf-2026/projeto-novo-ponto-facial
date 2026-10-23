import type { Detection, FaceLandmarkerResult } from '@mediapipe/tasks-vision';

export type FaceTrackingRequest = {
  type: 'init'; wasmUrl: string; landmarkerUrl: string; detectorUrl: string;
} | {
  type: 'frame'; frame: ImageBitmap; timestamp: number;
};

export type FaceTrackingResponse = { type: 'ready' } | { type: 'error' } | {
  type: 'result'; result: FaceLandmarkerResult; detections?: Detection[];
  width: number; height: number; timestamp: number;
};
