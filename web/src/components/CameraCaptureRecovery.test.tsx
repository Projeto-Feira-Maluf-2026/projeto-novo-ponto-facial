import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@mediapipe/tasks-vision', async () => ({
  ...await vi.importActual<typeof import('@mediapipe/tasks-vision')>('@mediapipe/tasks-vision'),
  FilesetResolver: { forVisionTasks: vi.fn(() => new Promise(() => undefined)) },
}));
import { CameraCapture } from './CameraCapture';

function setup() {
  window.localStorage.clear();
  const getUserMedia = vi.fn().mockRejectedValue(new DOMException('Unavailable', 'NotReadableError'));
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
    getUserMedia,
    enumerateDevices: vi.fn().mockResolvedValue([
      { kind: 'videoinput', deviceId: 'usb', label: 'USB Camera' },
    ]),
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  } });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  return getUserMedia;
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('camera recovery controls', () => {
  it('releases the selected stream when switching back to the browser default', async () => {
    const getUserMedia = setup();
    const stop = vi.fn();
    const usbTrack = { stop, readyState: 'live', muted: false, getSettings: () => ({ deviceId: 'usb' }) };
    const defaultTrack = { stop: vi.fn(), readyState: 'live', muted: false, getSettings: () => ({ deviceId: 'default-camera' }) };
    getUserMedia.mockResolvedValueOnce({ getTracks: () => [usbTrack], getVideoTracks: () => [usbTrack] })
      .mockResolvedValue({ getTracks: () => [defaultTrack], getVideoTracks: () => [defaultTrack] });
    const view = render(createElement(CameraCapture));
    await waitFor(() => expect(view.getByRole('combobox')).toHaveValue('usb'));
    fireEvent.change(view.getByRole('combobox'), { target: { value: '' } });
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    expect(stop).toHaveBeenCalledTimes(1);
    expect(getUserMedia.mock.calls[1][0].video).not.toHaveProperty('deviceId');
    view.unmount();
  });

  it('offers the camera selector after failure and lets the operator recover', async () => {
    const getUserMedia = setup();
    const onReady = vi.fn();
    const onError = vi.fn();
    const view = render(createElement(CameraCapture, { onReadyChange: onReady, onErrorChange: onError }));
    await waitFor(() => expect(view.getByRole('alert')).toBeInTheDocument());
    const picker = view.getByRole('combobox', { name: 'Selecionar câmera' });
    expect(picker).not.toBeDisabled();
    expect(onError).toHaveBeenLastCalledWith(expect.stringContaining('indisponível'));
    const stop = vi.fn();
    const track = { stop, readyState: 'live', muted: false, getSettings: () => ({ deviceId: 'usb' }) };
    getUserMedia.mockResolvedValue({ getTracks: () => [track], getVideoTracks: () => [track] });
    fireEvent.change(picker, { target: { value: 'usb' } });
    await waitFor(() => expect(onReady).toHaveBeenLastCalledWith(true));
    expect(view.queryByRole('alert')).toBeNull();
    view.unmount();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('stops automatic retries and leaves manual recovery available', async () => {
    const getUserMedia = setup();
    vi.useFakeTimers();
    const view = render(createElement(CameraCapture));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(getUserMedia).toHaveBeenCalledTimes(9);
    expect(view.getByRole('button', { name: 'Tentar novamente' })).not.toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(getUserMedia).toHaveBeenCalledTimes(9);
    view.unmount();
  });
});
