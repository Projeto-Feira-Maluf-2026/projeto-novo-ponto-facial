import type { FaceTrackingRequest, FaceTrackingResponse } from './faceTrackingProtocol';
import { createFaceTrackingEngine } from './faceTrackingEngine';

// No camera frames leave this worker. Only transient landmarks/boxes are returned.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<FaceTrackingRequest>) => void) | null;
  postMessage: (message: FaceTrackingResponse) => void;
};
const engine = createFaceTrackingEngine((message) => scope.postMessage(message), true);
scope.onmessage = (event) => {
  // Dedicated-worker messages carry an empty origin; anything else is not our page.
  if (event.origin !== '' && event.origin !== self.location.origin) return;
  void engine.handle(event.data);
};
