import type { Detection, FaceLandmarkerResult } from '@mediapipe/tasks-vision';

/** No worker o quadro chega como ImageBitmap; na thread principal, o próprio vídeo. */
export type FaceTrackingFrame = ImageBitmap | HTMLVideoElement;

export type FaceTrackingRequest = {
  type: 'init'; wasmUrl: string; landmarkerUrl: string; detectorUrl: string;
} | {
  type: 'frame'; frame: FaceTrackingFrame; timestamp: number;
};

export type FaceTrackingResponse = { type: 'ready' } | { type: 'error' } | {
  type: 'result'; result: FaceLandmarkerResult; detections?: Detection[];
  width: number; height: number; timestamp: number;
};
