import { describe, expect, it, vi } from 'vitest';
import { openCameraStream } from './cameraStream';

function camera(deviceId: string) {
  return { deviceId, kind: 'videoinput', label: deviceId } as MediaDeviceInfo;
}
function stream() {
  const stop = vi.fn();
  return { getTracks: () => [{ stop }], stop } as unknown as MediaStream & { stop: ReturnType<typeof vi.fn> };
}

describe('camera stream recovery', () => {
  it('recovers the selected device without resolution or frame rate constraints', async () => {
    const result = stream();
    const getUserMedia = vi.fn()
      .mockRejectedValueOnce(new DOMException('Driver mode failed', 'NotReadableError'))
      .mockResolvedValueOnce(result);
    const enumerate = vi.fn();
    expect(await openCameraStream({ getUserMedia }, 'usb', enumerate, () => true)).toBe(result);
    expect(getUserMedia).toHaveBeenLastCalledWith({ audio: false, video: { deviceId: { exact: 'usb' } } });
    expect(enumerate).not.toHaveBeenCalled();
  });

  it('tries the physical camera when the saved virtual camera cannot open', async () => {
    const result = stream();
    const getUserMedia = vi.fn()
      .mockRejectedValueOnce(new DOMException('Unavailable', 'NotReadableError'))
      .mockRejectedValueOnce(new DOMException('Unavailable', 'NotReadableError'))
      .mockResolvedValueOnce(result);
    const enumerate = vi.fn().mockResolvedValue([camera('virtual'), camera('usb')]);
    expect(await openCameraStream({ getUserMedia }, 'virtual', enumerate, () => true)).toBe(result);
    expect(getUserMedia).toHaveBeenLastCalledWith({ audio: false, video: { deviceId: { exact: 'usb' } } });
  });

  it('recovers a removed saved camera even if enumeration exposes no device ids', async () => {
    const result = stream();
    const getUserMedia = vi.fn()
      .mockRejectedValueOnce(new DOMException('Removed', 'NotFoundError'))
      .mockRejectedValueOnce(new DOMException('Removed', 'NotFoundError'))
      .mockResolvedValueOnce(result);
    await openCameraStream({ getUserMedia }, 'old', async () => [], () => true);
    expect(getUserMedia).toHaveBeenLastCalledWith({ audio: false, video: true });
  });

  it('does not retry or enumerate after permission is denied', async () => {
    const error = new DOMException('Denied', 'NotAllowedError');
    const getUserMedia = vi.fn().mockRejectedValue(error);
    const enumerate = vi.fn();
    await expect(openCameraStream({ getUserMedia }, '', enumerate, () => true)).rejects.toBe(error);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(enumerate).not.toHaveBeenCalled();
  });

  it('releases a late stream after navigation and never opens another device', async () => {
    const result = stream();
    let current = true;
    const getUserMedia = vi.fn(async () => { current = false; return result; });
    const enumerate = vi.fn();
    await expect(openCameraStream({ getUserMedia }, '', enumerate, () => current)).rejects.toMatchObject({ name: 'AbortError' });
    expect(result.stop).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('limits device attempts when every webcam fails', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException('Busy', 'NotReadableError'));
    const cameras = Array.from({ length: 10 }, (_, index) => camera(`usb-${index}`));
    await expect(openCameraStream({ getUserMedia }, '', async () => cameras, () => true)).rejects.toMatchObject({ name: 'NotReadableError' });
    expect(getUserMedia).toHaveBeenCalledTimes(6);
  });
});
