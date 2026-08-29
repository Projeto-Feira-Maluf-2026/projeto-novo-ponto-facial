import { Camera, RefreshCcw, Video } from 'lucide-react';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { FaceDetector, FaceLandmarker, FilesetResolver, type Detection } from '@mediapipe/tasks-vision';
import type { FaceLandmarkerResult, NormalizedLandmark } from '@mediapipe/tasks-vision';

export type FaceBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type DetectedFace = {
  boundingBox: FaceBox;
};

type NativeFaceDetector = {
  detect: (source: CanvasImageSource) => Promise<DetectedFace[]>;
};

type FaceDetectorConstructor = new (options?: { fastMode?: boolean; maxDetectedFaces?: number }) => NativeFaceDetector;

type VideoElementWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: (now: DOMHighResTimeStamp) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export interface CameraCaptureHandle {
  capture: (options?: {
    faceCrop?: boolean;
    sourceFaceBox?: FaceSourceBox | null;
  }) => string | null;
  captureFaces: (options?: { limit?: number }) => string[];
  restart: () => Promise<void>;
}

export type FaceOverlayTone = 'tracking' | 'success' | 'warning' | 'danger';

export interface FaceOverlayState {
  label?: string;
  detail?: string;
  tone?: FaceOverlayTone;
}

export interface FaceSourceBox {
  x: number;
  y: number;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
}

const MEDIAPIPE_VERSION = '0.10.35';
const LANDMARK_WASM_PATH = import.meta.env.VITE_MEDIAPIPE_WASM_URL?.trim()
  || `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const FACE_LANDMARKER_MODEL_PATH = import.meta.env.VITE_FACE_LANDMARKER_MODEL_URL?.trim()
  || 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const DISTANT_FACE_DETECTOR_MODEL_PATH = import.meta.env.VITE_FACE_DETECTOR_MODEL_URL?.trim()
  || 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_full_range/float16/1/blaze_face_full_range.tflite';
const MAX_TRACKED_FACES = 5;
const LANDMARK_FRAME_INTERVAL_MS = 32;
const DISTANT_SCAN_INTERVAL_MS = 110;
const DISTANT_DETECTION_TTL_MS = 850;
const DISTANT_TILE_SIZE = 512;
const CAMERA_RELEASE_DELAY_MS = 180;
const CAMERA_START_RETRIES = 2;
const SELECTED_CAMERA_STORAGE_KEY = 'ponto-facial:selected-camera';

function readStoredCameraId() {
  try {
    return window.localStorage.getItem(SELECTED_CAMERA_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function storeCameraId(deviceId: string) {
  try {
    window.localStorage.setItem(SELECTED_CAMERA_STORAGE_KEY, deviceId);
  } catch {
    // A câmera continua funcional quando o navegador bloqueia armazenamento local.
  }
}

const TONE_RGB: Record<FaceOverlayTone, string> = {
  tracking: '203, 213, 225',
  success: '74, 222, 128',
  warning: '251, 191, 36',
  danger: '248, 113, 113',
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

function faceBoxIou(left: FaceBox, right: FaceBox) {
  const intersectionLeft = Math.max(left.x, right.x);
  const intersectionTop = Math.max(left.y, right.y);
  const intersectionRight = Math.min(left.x + left.width, right.x + right.width);
  const intersectionBottom = Math.min(left.y + left.height, right.y + right.height);
  const intersection = Math.max(0, intersectionRight - intersectionLeft)
    * Math.max(0, intersectionBottom - intersectionTop);
  const union = left.width * left.height + right.width * right.height - intersection;
  return union > 0 ? intersection / union : 0;
}

export function mergeFaceBoxes(boxes: FaceBox[], limit = MAX_TRACKED_FACES) {
  return [...boxes]
    .sort((left, right) => right.width * right.height - left.width * left.height)
    .reduce<FaceBox[]>((merged, candidate) => {
      if (merged.length >= limit || merged.some((current) => faceBoxIou(current, candidate) > 0.32)) {
        return merged;
      }
      merged.push(candidate);
      return merged;
    }, [])
    .sort((left, right) => left.x - right.x);
}

export function isPlausibleDistantFace(detection: Detection, inputSize = DISTANT_TILE_SIZE) {
  const box = detection.boundingBox;
  const score = detection.categories[0]?.score || 0;
  if (!box || score < 0.55 || box.width <= 0 || box.height <= 0) return false;

  const aspectRatio = box.width / box.height;
  if (aspectRatio < 0.55 || aspectRatio > 1.55) return false;

  // BlazeFace fornece, nesta ordem, olhos, nariz e centro da boca. Objetos
  // confundidos com rostos raramente preservam essa geometria simultaneamente.
  if (detection.keypoints.length < 4) return false;
  const [rightEye, leftEye, nose, mouth] = detection.keypoints;
  const points = [rightEye, leftEye, nose, mouth].map((point) => ({
    x: point.x * inputSize,
    y: point.y * inputSize,
  }));
  const marginX = box.width * 0.18;
  const marginY = box.height * 0.18;
  const pointsInside = points.every((point) => (
    point.x >= box.originX - marginX
    && point.x <= box.originX + box.width + marginX
    && point.y >= box.originY - marginY
    && point.y <= box.originY + box.height + marginY
  ));
  if (!pointsInside) return false;

  const [rightEyePoint, leftEyePoint, nosePoint, mouthPoint] = points;
  const eyeLine = (rightEyePoint.y + leftEyePoint.y) / 2;
  const eyeDistance = Math.hypot(
    rightEyePoint.x - leftEyePoint.x,
    rightEyePoint.y - leftEyePoint.y,
  );
  return eyeDistance >= box.width * 0.16
    && eyeDistance <= box.width * 0.86
    && Math.abs(rightEyePoint.y - leftEyePoint.y) <= box.height * 0.34
    && nosePoint.y >= eyeLine - box.height * 0.06
    && nosePoint.y <= mouthPoint.y + box.height * 0.08
    && mouthPoint.y >= eyeLine + box.height * 0.08;
}

export function faceBoxesFromLandmarks(
  detectedLandmarks: NormalizedLandmark[][],
  limit = MAX_TRACKED_FACES,
): FaceBox[] {
  return detectedLandmarks
    .filter((landmarks) => landmarks.length > 0)
    .slice(0, Math.max(0, limit))
    .map((landmarks) => {
      const landmarkXs = landmarks.map((landmark) => landmark.x);
      const landmarkYs = landmarks.map((landmark) => landmark.y);
      const normalizedLeft = clamp(Math.min(...landmarkXs), 0, 1);
      const normalizedTop = clamp(Math.min(...landmarkYs), 0, 1);
      const normalizedRight = clamp(Math.max(...landmarkXs), 0, 1);
      const normalizedBottom = clamp(Math.max(...landmarkYs), 0, 1);
      return {
        x: normalizedLeft,
        y: normalizedTop,
        width: normalizedRight - normalizedLeft,
        height: normalizedBottom - normalizedTop,
      };
    });
}

export type FaceCropRegion = {
  sourceX: number;
  sourceY: number;
  side: number;
};

export function calculateFaceCropRegion(
  face: FaceBox,
  frameWidth: number,
  frameHeight: number,
  nearbyFaces: FaceBox[] = [],
  compact = false,
): FaceCropRegion | null {
  if (
    frameWidth <= 0
    || frameHeight <= 0
    || face.width <= 0
    || face.height <= 0
  ) return null;

  const faceWidth = face.width * frameWidth;
  const faceHeight = face.height * frameHeight;
  const distantFace = Math.max(faceWidth, faceHeight) < 150;
  const centerX = (face.x + face.width / 2) * frameWidth;
  const centerY = (face.y + face.height * 0.46) * frameHeight;
  const baseSide = Math.max(
    faceWidth * (compact ? 1.52 : distantFace ? 1.78 : 2.25),
    faceHeight * (compact ? 1.48 : distantFace ? 1.72 : 2.05),
    compact ? 96 : distantFace ? 128 : 220,
  );

  const nearestCenterDistance = nearbyFaces.reduce((nearest, candidate) => {
    const candidateCenterX = (candidate.x + candidate.width / 2) * frameWidth;
    const candidateCenterY = (candidate.y + candidate.height * 0.46) * frameHeight;
    const distance = Math.hypot(candidateCenterX - centerX, candidateCenterY - centerY);
    return distance > 0 ? Math.min(nearest, distance) : nearest;
  }, Number.POSITIVE_INFINITY);
  const minimumFaceSide = Math.max(faceWidth * 1.18, faceHeight * 1.15, 88);
  const separatedSide = Number.isFinite(nearestCenterDistance)
    ? Math.max(minimumFaceSide, nearestCenterDistance * 0.72)
    : baseSide;
  const cropSide = Math.min(
    baseSide,
    separatedSide,
    frameWidth,
    frameHeight,
  );

  return {
    sourceX: clamp(centerX - cropSide / 2, 0, frameWidth - cropSide),
    sourceY: clamp(centerY - cropSide / 2, 0, frameHeight - cropSide),
    side: cropSide,
  };
}

export function cameraAccessErrorMessage(error: unknown) {
  const errorName = error && typeof error === 'object' && 'name' in error
    ? String(error.name)
    : '';

  if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError') {
    return 'A câmera está bloqueada. Clique no cadeado do navegador, permita o acesso à câmera e tente novamente.';
  }
  if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
    return 'Nenhuma webcam foi encontrada. Reconecte ou habilite a câmera no Windows e tente novamente.';
  }
  if (errorName === 'NotReadableError' || errorName === 'TrackStartError') {
    return 'A webcam está ocupada ou indisponível. Feche OBS, Teams e outros aplicativos que usam a câmera e tente novamente.';
  }
  if (errorName === 'OverconstrainedError' || errorName === 'ConstraintNotSatisfiedError') {
    return 'A webcam não aceita a configuração solicitada. Selecione outra câmera ou tente novamente.';
  }
  if (errorName === 'SecurityError') {
    return 'O navegador só permite usar a câmera em uma conexão HTTPS segura.';
  }

  return 'Não foi possível iniciar a webcam. Verifique a permissão do navegador e tente novamente.';
}

interface CameraCaptureProps {
  className?: string;
  analysisPaused?: boolean;
  fitMode?: 'cover' | 'contain';
  faceOverlay?: FaceOverlayState;
  detectedFaceBox?: FaceSourceBox | null;
  onReadyChange?: (ready: boolean) => void;
  onFacePresenceChange?: (present: boolean) => void;
  onFaceCountChange?: (count: number) => void;
}

export const CameraCapture = forwardRef<CameraCaptureHandle, CameraCaptureProps>(
  ({
    className = '',
    analysisPaused = false,
    fitMode = 'cover',
    faceOverlay,
    detectedFaceBox,
    onReadyChange,
    onFacePresenceChange,
    onFaceCountChange,
  }, ref) => {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const landmarkCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const mountedRef = useRef(true);
    const restartTimerRef = useRef(0);
    const startPromiseRef = useRef<Promise<void> | null>(null);
    const startQueueRef = useRef<Promise<void>>(Promise.resolve());
    const cameraFailureCountRef = useRef(0);
    const restartCameraRef = useRef<(() => void) | null>(null);
    const faceOverlayRef = useRef<FaceOverlayState | undefined>(faceOverlay);
    const onReadyChangeRef = useRef(onReadyChange);
    const onFacePresenceChangeRef = useRef(onFacePresenceChange);
    const onFaceCountChangeRef = useRef(onFaceCountChange);
    const normalizedFaceBoxRef = useRef<FaceBox | null>(null);
    const normalizedFaceBoxesRef = useRef<FaceBox[]>([]);
    const nativeNormalizedFaceBoxesRef = useRef<FaceBox[]>([]);
    const startRequestIdRef = useRef(0);
    const selectedDeviceIdRef = useRef('');
    const analysisPausedRef = useRef(analysisPaused);
    const [ready, setReady] = useState(false);
    const [starting, setStarting] = useState(true);
    const [error, setError] = useState('');
    const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([]);
    const [selectedDeviceId, setSelectedDeviceId] = useState('');
    const [faceBoxes, setFaceBoxes] = useState<FaceBox[]>([]);
    const [landmarkState, setLandmarkState] = useState<'loading' | 'ready' | 'error' | 'unsupported'>('loading');
    const [landmarkFacePresent, setLandmarkFacePresent] = useState(false);
    const [landmarkFaceCount, setLandmarkFaceCount] = useState(0);

    useEffect(() => {
      faceOverlayRef.current = faceOverlay;
    }, [faceOverlay]);

    useEffect(() => {
      analysisPausedRef.current = analysisPaused;
    }, [analysisPaused]);

    useEffect(() => {
      onReadyChangeRef.current = onReadyChange;
      onFacePresenceChangeRef.current = onFacePresenceChange;
      onFaceCountChangeRef.current = onFaceCountChange;
    }, [onFaceCountChange, onFacePresenceChange, onReadyChange]);

    const stop = useCallback(() => {
      startRequestIdRef.current += 1;
      window.clearTimeout(restartTimerRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.srcObject = null;
      }
      setReady(false);
      setStarting(false);
      setFaceBoxes([]);
      normalizedFaceBoxRef.current = null;
      normalizedFaceBoxesRef.current = [];
      nativeNormalizedFaceBoxesRef.current = [];
      setLandmarkFaceCount(0);
      onFaceCountChangeRef.current?.(0);
      onReadyChangeRef.current?.(false);
    }, []);

    const refreshDevices = useCallback(async () => {
      if (!navigator.mediaDevices?.enumerateDevices) return [];
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter((device) => device.kind === 'videoinput');
      setVideoInputs(cameras);
      return cameras;
    }, []);

    const startCamera = useCallback(async (
      requestedDeviceId = selectedDeviceIdRef.current,
      forceRestart = false,
    ) => {
      if (!mountedRef.current) return;
      const currentTrack = streamRef.current?.getVideoTracks()[0];
      const currentDeviceId = currentTrack?.getSettings().deviceId || '';
      if (
        !forceRestart
        && currentTrack?.readyState === 'live'
        && (!requestedDeviceId || requestedDeviceId === currentDeviceId)
      ) {
        setError('');
        setStarting(false);
        setReady(true);
        onReadyChangeRef.current?.(true);
        return;
      }
      const previousStream = streamRef.current;
      stop();
      const requestId = startRequestIdRef.current + 1;
      startRequestIdRef.current = requestId;
      setStarting(true);
      setError('');
      if (!navigator.mediaDevices?.getUserMedia) {
        setStarting(false);
        setError('Câmera indisponível neste navegador.');
        return;
      }

      let stream: MediaStream | null = null;
      try {
        if (previousStream) {
          await new Promise((resolve) => window.setTimeout(resolve, CAMERA_RELEASE_DELAY_MS));
        }
        const preferredVideo: MediaTrackConstraints = {
          ...(requestedDeviceId
            ? { deviceId: { exact: requestedDeviceId } }
            : { facingMode: { ideal: 'user' } }),
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30, max: 30 },
        };

        let initialError: unknown;
        for (let attempt = 0; attempt <= CAMERA_START_RETRIES && !stream; attempt += 1) {
          try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: preferredVideo });
          } catch (cameraError) {
            initialError = cameraError;
            const errorName = cameraError && typeof cameraError === 'object' && 'name' in cameraError
              ? String(cameraError.name)
              : '';
            if (!['NotReadableError', 'TrackStartError'].includes(errorName) || attempt === CAMERA_START_RETRIES) {
              break;
            }
            await new Promise((resolve) => window.setTimeout(resolve, 220 * (attempt + 1)));
          }
        }
        if (!stream) {
          const errorName = initialError && typeof initialError === 'object' && 'name' in initialError
            ? String(initialError.name)
            : '';
          const canRetryWithDefaults = [
            'NotFoundError',
            'DevicesNotFoundError',
            'NotReadableError',
            'TrackStartError',
            'OverconstrainedError',
            'ConstraintNotSatisfiedError',
          ].includes(errorName);
          if (!canRetryWithDefaults) throw initialError;
          stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
        }

        const resolutionTrack = stream.getVideoTracks()[0];
        if (resolutionTrack?.applyConstraints && resolutionTrack.getCapabilities) {
          try {
            const capabilities = resolutionTrack.getCapabilities();
            const maximumWidth = Math.min(capabilities.width?.max || 1920, 2560);
            const maximumHeight = Math.min(capabilities.height?.max || 1080, 1440);
            await resolutionTrack.applyConstraints({
              width: { ideal: maximumWidth },
              height: { ideal: maximumHeight },
              frameRate: { ideal: 30, max: 30 },
            });
          } catch {
            // Algumas webcams anunciam resoluções que o driver não consegue aplicar.
            // Nesse caso, mantemos o melhor modo escolhido pelo navegador.
          }
        }

        if (requestId !== startRequestIdRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        const activeDeviceId = stream.getVideoTracks()[0]?.getSettings().deviceId || requestedDeviceId;
        if (activeDeviceId) {
          selectedDeviceIdRef.current = activeDeviceId;
          setSelectedDeviceId(activeDeviceId);
          storeCameraId(activeDeviceId);
        }
        const activeTrack = stream.getVideoTracks()[0];
        if (activeTrack) {
          activeTrack.onended = () => {
            if (!mountedRef.current || requestId !== startRequestIdRef.current) return;
            setReady(false);
            onReadyChangeRef.current?.(false);
            setError('A câmera foi desconectada. Reconecte o cabo; a leitura será retomada automaticamente.');
            restartTimerRef.current = window.setTimeout(() => {
              if (mountedRef.current) restartCameraRef.current?.();
            }, 900);
          };
        }
        try {
          await refreshDevices();
        } catch {
          // A captura pode funcionar mesmo quando o navegador não expõe a lista de dispositivos.
        }
        setError('');
        cameraFailureCountRef.current = 0;
        setReady(true);
        onReadyChangeRef.current?.(true);
      } catch (cameraError) {
        stream?.getTracks().forEach((track) => track.stop());
        if (streamRef.current === stream) streamRef.current = null;
        if (requestId === startRequestIdRef.current) {
          setError(cameraAccessErrorMessage(cameraError));
          const retryableErrors = new Set([
            'NotReadableError',
            'TrackStartError',
            'NotFoundError',
            'DevicesNotFoundError',
            'OverconstrainedError',
            'ConstraintNotSatisfiedError',
          ]);
          const errorName = cameraError instanceof DOMException ? cameraError.name : '';
          if (retryableErrors.has(errorName)) {
            cameraFailureCountRef.current += 1;
            const retryDelay = Math.min(1_200 * cameraFailureCountRef.current, 5_000);
            restartTimerRef.current = window.setTimeout(() => {
              if (mountedRef.current) restartCameraRef.current?.();
            }, retryDelay);
          }
        }
      } finally {
        if (requestId === startRequestIdRef.current) setStarting(false);
      }
    }, [refreshDevices, stop]);

    const start = useCallback(async (
      requestedDeviceId = selectedDeviceIdRef.current,
      forceRestart = false,
    ) => {
      const operation = startQueueRef.current
        .catch(() => undefined)
        .then(() => startCamera(requestedDeviceId, forceRestart));
      startQueueRef.current = operation;
      startPromiseRef.current = operation;
      await operation;
      if (startPromiseRef.current === operation) startPromiseRef.current = null;
    }, [startCamera]);

    useEffect(() => {
      restartCameraRef.current = () => void start(selectedDeviceIdRef.current);
      return () => {
        restartCameraRef.current = null;
      };
    }, [start]);

    const projectFaceBoxToVideo = useCallback((
      box: FaceBox,
      sourceWidth?: number,
      sourceHeight?: number,
    ): FaceBox | null => {
      const video = videoRef.current;
      const frameWidth = sourceWidth || video?.videoWidth || 0;
      const frameHeight = sourceHeight || video?.videoHeight || 0;
      if (!video || !frameWidth || !frameHeight || !video.clientWidth || !video.clientHeight) {
        return null;
      }

      const scale = fitMode === 'contain'
        ? Math.min(video.clientWidth / frameWidth, video.clientHeight / frameHeight)
        : Math.max(video.clientWidth / frameWidth, video.clientHeight / frameHeight);
      const renderedWidth = frameWidth * scale;
      const renderedHeight = frameHeight * scale;
      const offsetX = (video.clientWidth - renderedWidth) / 2;
      const offsetY = (video.clientHeight - renderedHeight) / 2;

      const width = box.width * scale;
      const rawX = offsetX + box.x * scale;

      return {
        x: video.clientWidth - rawX - width,
        y: offsetY + box.y * scale,
        width,
        height: box.height * scale,
      };
    }, [fitMode]);

    useEffect(() => {
      mountedRef.current = true;
      selectedDeviceIdRef.current = readStoredCameraId();
      void start(selectedDeviceIdRef.current);
      return () => {
        mountedRef.current = false;
        stop();
      };
    }, [start, stop]);

    useEffect(() => {
      const mediaDevices = navigator.mediaDevices;
      if (!mediaDevices?.addEventListener) return undefined;

      const handleDeviceChange = () => {
        void refreshDevices().then((cameras) => {
          const selectedStillExists = cameras.some(
            (camera) => camera.deviceId === selectedDeviceIdRef.current,
          );
          if (selectedDeviceIdRef.current && !selectedStillExists) {
            selectedDeviceIdRef.current = '';
            setSelectedDeviceId('');
            void start('');
          }
        }).catch(() => undefined);
      };

      mediaDevices.addEventListener('devicechange', handleDeviceChange);
      return () => mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    }, [refreshDevices, start]);

    useEffect(() => {
      if (!ready) {
        setLandmarkFacePresent(false);
        return undefined;
      }

      let cancelled = false;
      let animationFrame = 0;
      let videoFrameCallback = 0;
      let landmarker: FaceLandmarker | null = null;
      let distantDetector: FaceDetector | null = null;
      let distantCanvas: HTMLCanvasElement | null = null;
      let distantContext: CanvasRenderingContext2D | null = null;
      let distantTileIndex = 0;
      let lastDistantScanAt = 0;
      let lastLandmarkerFaceAt = 0;
      let distantCandidates: Array<{ box: FaceBox; expiresAt: number }> = [];
      let lastFacePresent = false;
      let lastFaceCount = 0;
      let lastVideoTime = -1;
      let lastLandmarkAt = 0;

      const setDetectedFaceCount = (count: number) => {
        const present = count > 0;
        if (lastFacePresent !== present) {
          lastFacePresent = present;
          setLandmarkFacePresent(present);
          onFacePresenceChangeRef.current?.(present);
        }
        if (lastFaceCount !== count) {
          lastFaceCount = count;
          setLandmarkFaceCount(count);
          onFaceCountChangeRef.current?.(count);
        }
      };

      const resizeCanvas = (canvas: HTMLCanvasElement) => {
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const width = Math.max(1, Math.round(rect.width * dpr));
        const height = Math.max(1, Math.round(rect.height * dpr));

        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }

        const context = canvas.getContext('2d');
        context?.setTransform(dpr, 0, 0, dpr, 0, 0);
        return {
          context,
          width: rect.width,
          height: rect.height,
        };
      };

      const projectLandmark = (landmark: NormalizedLandmark) => {
        const video = videoRef.current;
        if (!video || !video.videoWidth || !video.videoHeight || !video.clientWidth || !video.clientHeight) {
          return null;
        }

        const scale = Math.max(video.clientWidth / video.videoWidth, video.clientHeight / video.videoHeight);
        const renderedWidth = video.videoWidth * scale;
        const renderedHeight = video.videoHeight * scale;
        const offsetX = (video.clientWidth - renderedWidth) / 2;
        const offsetY = (video.clientHeight - renderedHeight) / 2;
        const rawX = offsetX + landmark.x * renderedWidth;

        return {
          x: video.clientWidth - rawX,
          y: offsetY + landmark.y * renderedHeight,
          z: landmark.z ?? 0,
        };
      };

      const drawLabel = (
        context: CanvasRenderingContext2D,
        landmarks: NormalizedLandmark[],
        color: string,
        faceIndex: number,
        faceCount: number,
      ) => {
        const points = landmarks.map(projectLandmark).filter(Boolean) as Array<{ x: number; y: number; z: number }>;
        if (!points.length) return;

        const left = Math.min(...points.map((point) => point.x));
        const top = Math.min(...points.map((point) => point.y));
        const right = Math.max(...points.map((point) => point.x));
        const bottom = Math.max(...points.map((point) => point.y));
        const canvasRect = context.canvas.getBoundingClientRect();
        const guideLeft = clamp(left - 14, 8, Math.max(8, canvasRect.width - 32));
        const guideTop = clamp(top - 16, 8, Math.max(8, canvasRect.height - 32));
        const guideRight = clamp(right + 14, guideLeft + 32, Math.max(guideLeft + 32, canvasRect.width - 8));
        const guideBottom = clamp(bottom + 18, guideTop + 40, Math.max(guideTop + 40, canvasRect.height - 8));
        const cornerLength = clamp(Math.min(guideRight - guideLeft, guideBottom - guideTop) * 0.20, 18, 40);
        const labelY = guideTop > 42 ? guideTop - 36 : guideTop + 10;
        const labelX = clamp(guideLeft, 10, Math.max(10, canvasRect.width - 242));
        const overlay = faceOverlayRef.current;
        const label = faceCount > 1 ? `Rosto ${faceIndex + 1}` : overlay?.label || 'Rosto detectado';
        const detail = faceCount === 1 && overlay?.detail ? ` ${overlay.detail}` : '';
        const text = `${label}${detail}`;

        context.font = '650 12px Inter, ui-sans-serif, system-ui, sans-serif';
        const textWidth = Math.min(context.measureText(text).width, 230);
        const pillWidth = Math.min(Math.max(textWidth + 22, 118), 252);
        const pillHeight = 26;
        const radius = 5;

        context.save();
        context.strokeStyle = `rgba(${color}, 0.96)`;
        context.lineWidth = 2.5;
        context.lineCap = 'round';
        context.lineJoin = 'round';

        context.beginPath();
        context.moveTo(guideLeft, guideTop + cornerLength);
        context.lineTo(guideLeft, guideTop);
        context.lineTo(guideLeft + cornerLength, guideTop);
        context.moveTo(guideRight - cornerLength, guideTop);
        context.lineTo(guideRight, guideTop);
        context.lineTo(guideRight, guideTop + cornerLength);
        context.moveTo(guideRight, guideBottom - cornerLength);
        context.lineTo(guideRight, guideBottom);
        context.lineTo(guideRight - cornerLength, guideBottom);
        context.moveTo(guideLeft + cornerLength, guideBottom);
        context.lineTo(guideLeft, guideBottom);
        context.lineTo(guideLeft, guideBottom - cornerLength);
        context.stroke();

        context.fillStyle = 'rgba(9, 13, 18, 0.86)';
        context.beginPath();
        context.roundRect(labelX, labelY, pillWidth, pillHeight, radius);
        context.fill();
        context.fillStyle = '#ffffff';
        context.textBaseline = 'middle';
        context.fillText(text, labelX + 11, labelY + pillHeight / 2, pillWidth - 20);
        context.restore();
      };

      const drawFaces = (result: FaceLandmarkerResult) => {
        const canvas = landmarkCanvasRef.current;
        if (!canvas) return;

        const { context, width, height } = resizeCanvas(canvas);
        if (!context) return;

        context.clearRect(0, 0, width, height);
        const detectedLandmarks = (result.faceLandmarks || [])
          .filter((landmarks) => landmarks.length > 0)
          .slice(0, MAX_TRACKED_FACES);
        if (!detectedLandmarks.length) {
          const now = performance.now();
          distantCandidates = distantCandidates.filter((candidate) => candidate.expiresAt > now);
          const distantBoxes = mergeFaceBoxes(distantCandidates.map((candidate) => candidate.box));
          if (distantBoxes.length) {
            normalizedFaceBoxesRef.current = distantBoxes;
            normalizedFaceBoxRef.current = distantBoxes[0];
            setDetectedFaceCount(distantBoxes.length);
            const color = TONE_RGB.tracking;
            distantBoxes.forEach((box, index) => {
              drawLabel(context, [
                { x: box.x, y: box.y, z: 0, visibility: 1 },
                { x: box.x + box.width, y: box.y, z: 0, visibility: 1 },
                { x: box.x + box.width, y: box.y + box.height, z: 0, visibility: 1 },
                { x: box.x, y: box.y + box.height, z: 0, visibility: 1 },
              ], color, index, distantBoxes.length);
            });
            return;
          }
          normalizedFaceBoxRef.current = null;
          normalizedFaceBoxesRef.current = [];
          setDetectedFaceCount(0);
          return;
        }

        const normalizedBoxes = faceBoxesFromLandmarks(detectedLandmarks);
        lastLandmarkerFaceAt = performance.now();
        distantCandidates = [];
        normalizedFaceBoxesRef.current = normalizedBoxes;
        normalizedFaceBoxRef.current = normalizedBoxes.reduce((largest, box) => (
          box.width * box.height > largest.width * largest.height ? box : largest
        ));
        setDetectedFaceCount(detectedLandmarks.length);
        const tone = faceOverlayRef.current?.tone || 'tracking';
        const color = TONE_RGB[detectedLandmarks.length > 1 ? 'tracking' : tone];
        detectedLandmarks.forEach((landmarks, index) => {
          drawLabel(context, landmarks, color, index, detectedLandmarks.length);
        });
      };

      const scanDistantTile = (now: number) => {
        const video = videoRef.current;
        if (
          !distantDetector
          || !distantCanvas
          || !distantContext
          || !video
          || !video.videoWidth
          || !video.videoHeight
          || now - lastDistantScanAt < DISTANT_SCAN_INTERVAL_MS
          || now - lastLandmarkerFaceAt < 420
        ) return;

        lastDistantScanAt = now;
        const columns = 3;
        const rows = 2;
        const column = distantTileIndex % columns;
        const row = Math.floor(distantTileIndex / columns) % rows;
        distantTileIndex = (distantTileIndex + 1) % (columns * rows);
        const sourceWidth = video.videoWidth * 0.46;
        const sourceHeight = video.videoHeight * 0.64;
        const sourceX = column * ((video.videoWidth - sourceWidth) / Math.max(columns - 1, 1));
        const sourceY = row * ((video.videoHeight - sourceHeight) / Math.max(rows - 1, 1));

        distantContext.drawImage(
          video,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          0,
          0,
          DISTANT_TILE_SIZE,
          DISTANT_TILE_SIZE,
        );
        const detections = distantDetector.detect(distantCanvas).detections
          .filter((detection) => isPlausibleDistantFace(detection));
        const expiresAt = now + DISTANT_DETECTION_TTL_MS;
        const detectedBoxes = detections.flatMap((detection) => {
          const box = detection.boundingBox;
          if (!box) return [];
          const normalizedBox = {
            x: clamp((sourceX + (box.originX / DISTANT_TILE_SIZE) * sourceWidth) / video.videoWidth, 0, 1),
            y: clamp((sourceY + (box.originY / DISTANT_TILE_SIZE) * sourceHeight) / video.videoHeight, 0, 1),
            width: clamp((box.width / DISTANT_TILE_SIZE) * sourceWidth / video.videoWidth, 0, 1),
            height: clamp((box.height / DISTANT_TILE_SIZE) * sourceHeight / video.videoHeight, 0, 1),
          };
          return normalizedBox.width > 0.012 && normalizedBox.height > 0.02
            ? [{ box: normalizedBox, expiresAt }]
            : [];
        });
        if (detectedBoxes.length) {
          distantCandidates = [
            ...distantCandidates.filter((candidate) => candidate.expiresAt > now),
            ...detectedBoxes,
          ];
        }
      };

      const processFrame = (now: DOMHighResTimeStamp) => {
        if (
          cancelled
          || document.hidden
          || analysisPausedRef.current
          || now - lastLandmarkAt < LANDMARK_FRAME_INTERVAL_MS
        ) return;

        const video = videoRef.current;
        if (landmarker && video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          if (video.currentTime === lastVideoTime) return;
          lastVideoTime = video.currentTime;
          lastLandmarkAt = now;
          try {
            drawFaces(landmarker.detectForVideo(video, now));
            scanDistantTile(now);
          } catch {
            setLandmarkState('error');
          }
        }
      };

      const scheduleFrame = () => {
        if (cancelled) return;

        const video = videoRef.current as VideoElementWithFrameCallback | null;
        if (video?.requestVideoFrameCallback) {
          videoFrameCallback = video.requestVideoFrameCallback((now) => {
            processFrame(now);
            scheduleFrame();
          });
          return;
        }

        animationFrame = window.requestAnimationFrame((now) => {
          processFrame(now);
          scheduleFrame();
        });
      };

      (async () => {
        try {
          setLandmarkState('loading');
          const vision = await FilesetResolver.forVisionTasks(LANDMARK_WASM_PATH);
          if (cancelled) return;

          const landmarkerOptions = {
            runningMode: 'VIDEO' as const,
            numFaces: MAX_TRACKED_FACES,
            minFaceDetectionConfidence: 0.36,
            minFacePresenceConfidence: 0.36,
            minTrackingConfidence: 0.36,
            outputFaceBlendshapes: false,
            outputFacialTransformationMatrixes: true,
          };

          try {
            landmarker = await FaceLandmarker.createFromOptions(vision, {
              ...landmarkerOptions,
              baseOptions: {
                modelAssetPath: FACE_LANDMARKER_MODEL_PATH,
                delegate: 'GPU',
              },
            });
          } catch {
            landmarker = await FaceLandmarker.createFromOptions(vision, {
              ...landmarkerOptions,
              baseOptions: {
                modelAssetPath: FACE_LANDMARKER_MODEL_PATH,
                delegate: 'CPU',
              },
            });
          }

          if (cancelled) {
            landmarker.close();
            return;
          }

          setLandmarkState('ready');
          try {
            distantCanvas = document.createElement('canvas');
            distantCanvas.width = DISTANT_TILE_SIZE;
            distantCanvas.height = DISTANT_TILE_SIZE;
            distantContext = distantCanvas.getContext('2d', { alpha: false });
            distantDetector = await FaceDetector.createFromOptions(vision, {
              baseOptions: {
                modelAssetPath: DISTANT_FACE_DETECTOR_MODEL_PATH,
                delegate: 'CPU',
              },
              runningMode: 'IMAGE',
              minDetectionConfidence: 0.50,
              minSuppressionThreshold: 0.35,
            });
          } catch {
            distantDetector = null;
          }
          scheduleFrame();
        } catch {
          if (!cancelled) {
            setLandmarkState('unsupported');
            setLandmarkFacePresent(false);
          }
        }
      })();

      return () => {
        cancelled = true;
        window.cancelAnimationFrame(animationFrame);
        (videoRef.current as VideoElementWithFrameCallback | null)?.cancelVideoFrameCallback?.(videoFrameCallback);
        const canvas = landmarkCanvasRef.current;
        const context = canvas?.getContext('2d');
        if (canvas && context) {
          context.clearRect(0, 0, canvas.width, canvas.height);
        }
        landmarker?.close();
        distantDetector?.close();
        normalizedFaceBoxRef.current = null;
        normalizedFaceBoxesRef.current = [];
        setLandmarkFacePresent(false);
        setLandmarkFaceCount(0);
        onFaceCountChangeRef.current?.(0);
        onFacePresenceChangeRef.current?.(false);
      };
    }, [ready]);

    useEffect(() => {
      if (!ready || landmarkState === 'ready') {
        setFaceBoxes([]);
        nativeNormalizedFaceBoxesRef.current = [];
        return undefined;
      }

      const FaceDetectorApi = (window as Window & { FaceDetector?: FaceDetectorConstructor }).FaceDetector;
      if (!FaceDetectorApi) {
        setFaceBoxes([]);
        nativeNormalizedFaceBoxesRef.current = [];
        return undefined;
      }

      const detector = new FaceDetectorApi({ fastMode: true, maxDetectedFaces: MAX_TRACKED_FACES });
      let cancelled = false;
      let timer = 0;

      const detect = async () => {
        if (analysisPausedRef.current) {
          timer = window.setTimeout(detect, 80);
          return;
        }
        const video = videoRef.current;
        if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
          timer = window.setTimeout(detect, 80);
          return;
        }

        try {
          const faces = await detector.detect(video);
          if (!cancelled) {
            nativeNormalizedFaceBoxesRef.current = faces.map(({ boundingBox }) => ({
              x: boundingBox.x / video.videoWidth,
              y: boundingBox.y / video.videoHeight,
              width: boundingBox.width / video.videoWidth,
              height: boundingBox.height / video.videoHeight,
            }));
            setFaceBoxes(faces
              .map(({ boundingBox }) => projectFaceBoxToVideo(boundingBox))
              .filter(Boolean) as FaceBox[]);
          }
        } catch {
          if (!cancelled) {
            setFaceBoxes([]);
            nativeNormalizedFaceBoxesRef.current = [];
          }
        }

        if (!cancelled) {
          timer = window.setTimeout(detect, 80);
        }
      };

      detect();

      return () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
    }, [landmarkState, projectFaceBoxToVideo, ready]);

    useEffect(() => {
      if (landmarkState === 'ready') return;
      const count = faceBoxes.length;
      onFaceCountChangeRef.current?.(count);
      onFacePresenceChangeRef.current?.(count > 0);
    }, [faceBoxes.length, landmarkState]);

    useImperativeHandle(
      ref,
      () => {
        const captureNormalizedFace = (
          normalizedFace: FaceBox,
          compact = false,
          nearbyFaces: FaceBox[] = [],
        ) => {
          const video = videoRef.current;
          const canvas = canvasRef.current;
          if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
            return null;
          }
          const crop = calculateFaceCropRegion(
            normalizedFace,
            video.videoWidth,
            video.videoHeight,
            nearbyFaces,
            compact,
          );
          if (!crop) return null;
          const distantFace = Math.max(
            normalizedFace.width * video.videoWidth,
            normalizedFace.height * video.videoHeight,
          ) < 150;
          const targetSize = crop.side < 720 ? 512 : Math.min(720, Math.round(crop.side));
          canvas.width = targetSize;
          canvas.height = targetSize;
          const context = canvas.getContext('2d');
          if (!context) return null;
          context.imageSmoothingEnabled = true;
          context.imageSmoothingQuality = 'high';
          context.drawImage(
            video,
            crop.sourceX,
            crop.sourceY,
            crop.side,
            crop.side,
            0,
            0,
            targetSize,
            targetSize,
          );
          return canvas.toDataURL('image/jpeg', distantFace ? 0.94 : 0.9);
        };

        return {
          capture: (options) => {
            const video = videoRef.current;
            const canvas = canvasRef.current;
            if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
              return null;
            }
            const sourceFaceBox = options?.sourceFaceBox;
            const serverNormalizedFace = sourceFaceBox
              && sourceFaceBox.sourceWidth > 0
              && sourceFaceBox.sourceHeight > 0
              ? {
                  x: sourceFaceBox.x / sourceFaceBox.sourceWidth,
                  y: sourceFaceBox.y / sourceFaceBox.sourceHeight,
                  width: sourceFaceBox.width / sourceFaceBox.sourceWidth,
                  height: sourceFaceBox.height / sourceFaceBox.sourceHeight,
                }
              : null;
            const normalizedFace = options?.faceCrop
              ? serverNormalizedFace || normalizedFaceBoxRef.current
              : null;
            if (normalizedFace) return captureNormalizedFace(normalizedFace);
            const captureScale = Math.min(1, 1920 / video.videoWidth, 1080 / video.videoHeight);
            canvas.width = Math.round(video.videoWidth * captureScale);
            canvas.height = Math.round(video.videoHeight * captureScale);
            const context = canvas.getContext('2d');
            if (!context) {
              return null;
            }
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            return canvas.toDataURL('image/jpeg', 0.92);
          },
          captureFaces: (options) => {
            const limit = clamp(options?.limit || MAX_TRACKED_FACES, 1, MAX_TRACKED_FACES);
            const boxes = normalizedFaceBoxesRef.current.length
              ? normalizedFaceBoxesRef.current
              : nativeNormalizedFaceBoxesRef.current;
            const orderedBoxes = [...boxes].sort((left, right) => left.x - right.x);
            return orderedBoxes
              .slice(0, limit)
              .map((box) => captureNormalizedFace(
                box,
                orderedBoxes.length > 1,
                orderedBoxes.filter((candidate) => candidate !== box),
              ))
              .filter(Boolean) as string[];
          },
          restart: () => start(selectedDeviceIdRef.current, true),
        };
      },
      [start],
    );

    const projectedApiFaceBox = useMemo(() => {
      if (!detectedFaceBox) return null;
      return projectFaceBoxToVideo(
        {
          x: detectedFaceBox.x,
          y: detectedFaceBox.y,
          width: detectedFaceBox.width,
          height: detectedFaceBox.height,
        },
        detectedFaceBox.sourceWidth,
        detectedFaceBox.sourceHeight,
      );
    }, [detectedFaceBox, projectFaceBoxToVideo]);

    const displayFaceBoxes = landmarkFacePresent
      ? []
      : faceBoxes.length
        ? faceBoxes
        : projectedApiFaceBox
          ? [projectedApiFaceBox]
          : [];
    const faceOutlines = displayFaceBoxes.map((displayFaceBox) => ({
      width: displayFaceBox.width * 1.34,
      height: displayFaceBox.height * 1.72,
      left: displayFaceBox.x - displayFaceBox.width * 0.17,
      top: displayFaceBox.y - displayFaceBox.height * 0.34,
    }));
    const overlayLabel = faceOverlay?.label || 'Rosto detectado';
    const overlayTone = faceOverlay?.tone || 'tracking';
    const visibleFaceCount = landmarkFacePresent ? landmarkFaceCount : displayFaceBoxes.length;
    let cameraStatusLabel = starting ? 'Iniciando câmera' : 'Câmera indisponível';
    if (ready) {
      if (visibleFaceCount > 1) {
        cameraStatusLabel = `${visibleFaceCount} rostos enquadrados`;
      } else if (visibleFaceCount === 1) {
        cameraStatusLabel = overlayTone === 'success' ? 'Rosto identificado' : 'Rosto enquadrado';
      } else {
        cameraStatusLabel = landmarkState === 'loading' ? 'Preparando leitura' : 'Câmera ativa';
      }
    }

    const selectCamera = (deviceId: string) => {
      selectedDeviceIdRef.current = deviceId;
      setSelectedDeviceId(deviceId);
      storeCameraId(deviceId);
      void start(deviceId);
    };

    return (
      <div className={`camera-view app-view-transition ${className}`} data-fit={fitMode}>
        <video ref={videoRef} className="h-full w-full object-cover" autoPlay muted playsInline />
        <canvas ref={canvasRef} className="hidden" />
        <canvas ref={landmarkCanvasRef} className="face-landmark-canvas" />

        {faceOutlines.map((faceOutline, index) => (
          <div
            key={`face-${index}`}
            className="face-outline face-track-overlay"
            data-tone={overlayTone}
            data-face-index={index + 1}
            style={{
              left: `${faceOutline.left}px`,
              top: `${faceOutline.top}px`,
              width: `${faceOutline.width}px`,
              height: `${faceOutline.height}px`,
            }}
          >
            <div className={`face-track-label ${faceOutline.top < 34 ? 'face-track-label-inside' : ''}`}>
              {faceOutlines.length > 1 ? `Rosto ${index + 1}` : overlayLabel}
              {faceOutlines.length === 1 && faceOverlay?.detail && <span>{faceOverlay.detail}</span>}
            </div>
            <svg viewBox="0 0 220 280" className="face-outline-vector">
              <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                <path strokeWidth="3" d="M110 15 C52 18 25 68 30 135 C35 212 72 260 110 265 C148 260 185 212 190 135 C195 68 168 18 110 15 Z" />
                <path strokeWidth="1.6" strokeOpacity="0.42" d="M78 62 C98 51 123 51 143 62" />
                <path strokeWidth="1.6" strokeOpacity="0.42" d="M75 218 C94 232 126 232 145 218" />
              </g>
            </svg>
          </div>
        ))}

        <div className="camera-chip absolute left-3 top-3">
          <Camera size={15} />
          {cameraStatusLabel}
        </div>

        <div className="camera-device-controls">
          {videoInputs.length > 1 && (
            <label className="camera-device-picker">
              <Video size={14} aria-hidden="true" />
              <span className="sr-only">Selecionar câmera</span>
              <select
                value={selectedDeviceId}
                onChange={(event) => selectCamera(event.target.value)}
                aria-label="Selecionar câmera"
              >
                {videoInputs.map((device, index) => (
                  <option key={device.deviceId || `camera-${index}`} value={device.deviceId}>
                    {device.label || `Câmera ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            onClick={() => void start(selectedDeviceIdRef.current, true)}
            className="camera-restart-button"
            title="Reiniciar câmera"
            aria-label="Reiniciar câmera"
            disabled={starting}
          >
            <RefreshCcw size={15} className={starting ? 'animate-spin' : ''} />
          </button>
        </div>

        {error && (
          <div className="camera-error-panel" role="alert" aria-live="assertive">
            <span>{error}</span>
            <button type="button" onClick={() => void start(selectedDeviceIdRef.current, true)} disabled={starting}>
              Tentar novamente
            </button>
          </div>
        )}
      </div>
    );
  },
);

CameraCapture.displayName = 'CameraCapture';
