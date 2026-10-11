const recoverableErrors = new Set([
  'NotReadableError', 'TrackStartError', 'NotFoundError', 'DevicesNotFoundError',
  'OverconstrainedError', 'ConstraintNotSatisfiedError',
]);

export function isRecoverableCameraError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'name' in error
    && recoverableErrors.has(String(error.name));
}

/** Try a compatible mode before moving to another permitted video input. */
export async function openCameraStream(
  mediaDevices: Pick<MediaDevices, 'getUserMedia'>,
  requestedDeviceId: string,
  refreshDevices: () => Promise<MediaDeviceInfo[]>,
  isCurrent: () => boolean,
): Promise<MediaStream> {
  const checkCurrent = () => {
    if (!isCurrent()) throw new DOMException('Camera request cancelled', 'AbortError');
  };
  const open = async (video: boolean | MediaTrackConstraints) => {
    checkCurrent();
    const stream = await mediaDevices.getUserMedia({ audio: false, video });
    if (!isCurrent()) {
      stream.getTracks().forEach((track) => track.stop());
      checkCurrent();
    }
    return stream;
  };
  const device = requestedDeviceId ? { deviceId: { exact: requestedDeviceId } } : {};
  try {
    return await open({ ...device, facingMode: { ideal: 'user' },
      width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } });
  } catch (error) {
    if (!isRecoverableCameraError(error)) throw error;
  }

  let lastError: unknown;
  try {
    // No resolution/FPS requirements: let the camera driver select its native mode.
    return await open(requestedDeviceId ? device : true);
  } catch (error) {
    if (!isRecoverableCameraError(error)) throw error;
    lastError = error;
  }
  checkCurrent();
  const cameras = await refreshDevices().catch(() => []);
  checkCurrent();
  // Enumeration can be restricted before permission. The browser default is
  // still useful when a saved camera has disappeared.
  const alternatives: Array<boolean | MediaTrackConstraints> = cameras
    .filter((camera) => camera.deviceId && camera.deviceId !== requestedDeviceId)
    .slice(0, 4)
    .map((camera) => ({ deviceId: { exact: camera.deviceId } }));
  if (requestedDeviceId && !alternatives.length) alternatives.push(true);
  for (const video of alternatives) {
    try {
      return await open(video);
    } catch (error) {
      if (!isRecoverableCameraError(error)) throw error;
      lastError = error;
    }
  }
  throw lastError;
}
