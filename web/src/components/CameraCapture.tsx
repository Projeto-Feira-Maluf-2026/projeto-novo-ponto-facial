import { Camera, RefreshCcw } from 'lucide-react';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { FaceLandmarkerResult, NormalizedLandmark } from '@mediapipe/tasks-vision';

type FaceBox = {
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

const LANDMARK_WASM_PATH = '/mediapipe/wasm';
const FACE_LANDMARKER_MODEL_PATH = '/mediapipe/face_landmarker.task';

const TONE_RGB: Record<FaceOverlayTone, string> = {
  tracking: '203, 213, 225',
  success: '74, 222, 128',
  warning: '251, 191, 36',
  danger: '248, 113, 113',
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

interface CameraCaptureProps {
  className?: string;
  faceOverlay?: FaceOverlayState;
  detectedFaceBox?: FaceSourceBox | null;
  onReadyChange?: (ready: boolean) => void;
  onFacePresenceChange?: (present: boolean) => void;
}

export const CameraCapture = forwardRef<CameraCaptureHandle, CameraCaptureProps>(
  ({
    className = '',
    faceOverlay,
    detectedFaceBox,
    onReadyChange,
    onFacePresenceChange,
  }, ref) => {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const landmarkCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const faceOverlayRef = useRef<FaceOverlayState | undefined>(faceOverlay);
    const normalizedFaceBoxRef = useRef<FaceBox | null>(null);
    const startRequestIdRef = useRef(0);
    const [ready, setReady] = useState(false);
    const [error, setError] = useState('');
    const [faceBox, setFaceBox] = useState<FaceBox | null>(null);
    const [landmarkState, setLandmarkState] = useState<'loading' | 'ready' | 'error' | 'unsupported'>('loading');
    const [landmarkFacePresent, setLandmarkFacePresent] = useState(false);

    useEffect(() => {
      faceOverlayRef.current = faceOverlay;
    }, [faceOverlay]);

    const stop = useCallback(() => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setReady(false);
      setFaceBox(null);
      normalizedFaceBoxRef.current = null;
      onReadyChange?.(false);
    }, [onReadyChange]);

    const start = useCallback(async () => {
      const requestId = startRequestIdRef.current + 1;
      startRequestIdRef.current = requestId;
      stop();
      setError('');
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Câmera indisponível neste navegador.');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: 'user',
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, max: 30 },
          },
        });
        if (requestId !== startRequestIdRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setError('');
        setReady(true);
        onReadyChange?.(true);
      } catch {
        if (requestId === startRequestIdRef.current) {
          setError('Permita o acesso à câmera para capturar a face.');
        }
      }
    }, [onReadyChange, stop]);

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

      const scale = Math.max(video.clientWidth / frameWidth, video.clientHeight / frameHeight);
      const renderedWidth = frameWidth * scale;
      const renderedHeight = frameHeight * scale;
      const offsetX = (video.clientWidth - renderedWidth) / 2;
      const offsetY = (video.clientHeight - renderedHeight) / 2;

      return {
        x: offsetX + box.x * scale,
        y: offsetY + box.y * scale,
        width: box.width * scale,
        height: box.height * scale,
      };
    }, []);

    useEffect(() => {
      start();
      return stop;
    }, [start, stop]);

    useEffect(() => {
      if (!ready) {
        setLandmarkFacePresent(false);
        return undefined;
      }

      let cancelled = false;
      let animationFrame = 0;
      let videoFrameCallback = 0;
      let landmarker: FaceLandmarker | null = null;
      let lastFacePresent = false;
      let lastVideoTime = -1;
      let lastLandmarkAt = 0;

      const setFacePresent = (present: boolean) => {
        if (lastFacePresent === present) return;
        lastFacePresent = present;
        setLandmarkFacePresent(present);
        onFacePresenceChange?.(present);
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

        return {
          x: offsetX + landmark.x * renderedWidth,
          y: offsetY + landmark.y * renderedHeight,
          z: landmark.z ?? 0,
        };
      };

      const drawLabel = (
        context: CanvasRenderingContext2D,
        landmarks: NormalizedLandmark[],
        color: string,
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
        const label = overlay?.label || 'Rosto detectado';
        const detail = overlay?.detail ? ` ${overlay.detail}` : '';
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

      const drawFace = (result: FaceLandmarkerResult) => {
        const canvas = landmarkCanvasRef.current;
        if (!canvas) return;

        const { context, width, height } = resizeCanvas(canvas);
        if (!context) return;

        context.clearRect(0, 0, width, height);
        const landmarks = result.faceLandmarks?.[0];
        if (!landmarks?.length) {
          normalizedFaceBoxRef.current = null;
          setFacePresent(false);
          return;
        }

        const landmarkXs = landmarks.map((landmark) => landmark.x);
        const landmarkYs = landmarks.map((landmark) => landmark.y);
        const normalizedLeft = clamp(Math.min(...landmarkXs), 0, 1);
        const normalizedTop = clamp(Math.min(...landmarkYs), 0, 1);
        const normalizedRight = clamp(Math.max(...landmarkXs), 0, 1);
        const normalizedBottom = clamp(Math.max(...landmarkYs), 0, 1);
        normalizedFaceBoxRef.current = {
          x: normalizedLeft,
          y: normalizedTop,
          width: normalizedRight - normalizedLeft,
          height: normalizedBottom - normalizedTop,
        };
        setFacePresent(true);
        const tone = faceOverlayRef.current?.tone || 'tracking';
        const color = TONE_RGB[tone];
        drawLabel(context, landmarks, color);
      };

      const processFrame = (now: DOMHighResTimeStamp) => {
        if (cancelled || document.hidden || now - lastLandmarkAt < 90) return;

        const video = videoRef.current;
        if (landmarker && video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          if (video.currentTime === lastVideoTime) return;
          lastVideoTime = video.currentTime;
          lastLandmarkAt = now;
          try {
            drawFace(landmarker.detectForVideo(video, now));
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
            numFaces: 1,
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
        normalizedFaceBoxRef.current = null;
        setLandmarkFacePresent(false);
        onFacePresenceChange?.(false);
      };
    }, [onFacePresenceChange, ready]);

    useEffect(() => {
      if (!ready) {
        setFaceBox(null);
        return undefined;
      }

      const FaceDetectorApi = (window as Window & { FaceDetector?: FaceDetectorConstructor }).FaceDetector;
      if (!FaceDetectorApi) {
        setFaceBox(null);
        return undefined;
      }

      const detector = new FaceDetectorApi({ fastMode: true, maxDetectedFaces: 1 });
      let cancelled = false;
      let timer = 0;

      const detect = async () => {
        const video = videoRef.current;
        if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
          timer = window.setTimeout(detect, 240);
          return;
        }

        try {
          const faces = await detector.detect(video);
          if (!cancelled) {
            setFaceBox(faces[0] ? projectFaceBoxToVideo(faces[0].boundingBox) : null);
          }
        } catch {
          if (!cancelled) {
            setFaceBox(null);
          }
        }

        if (!cancelled) {
          timer = window.setTimeout(detect, 240);
        }
      };

      detect();

      return () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
    }, [projectFaceBoxToVideo, ready]);

    useImperativeHandle(
      ref,
      () => ({
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
          if (normalizedFace && normalizedFace.width > 0 && normalizedFace.height > 0) {
            const faceCenterX = (normalizedFace.x + normalizedFace.width / 2) * video.videoWidth;
            const faceCenterY = (
              normalizedFace.y
              + normalizedFace.height * 0.46
            ) * video.videoHeight;
            const requestedSide = Math.max(
              normalizedFace.width * video.videoWidth * 2.25,
              normalizedFace.height * video.videoHeight * 2.05,
              220,
            );
            const cropSide = Math.min(
              requestedSide,
              video.videoWidth,
              video.videoHeight,
            );
            const sourceX = clamp(
              faceCenterX - cropSide / 2,
              0,
              video.videoWidth - cropSide,
            );
            const sourceY = clamp(
              faceCenterY - cropSide / 2,
              0,
              video.videoHeight - cropSide,
            );
            const targetSize = cropSide < 540 ? 720 : Math.min(960, Math.round(cropSide));
            canvas.width = targetSize;
            canvas.height = targetSize;
            const context = canvas.getContext('2d');
            if (!context) return null;
            context.imageSmoothingEnabled = true;
            context.imageSmoothingQuality = 'high';
            context.drawImage(
              video,
              sourceX,
              sourceY,
              cropSide,
              cropSide,
              0,
              0,
              targetSize,
              targetSize,
            );
            return canvas.toDataURL('image/jpeg', 0.90);
          }
          const captureScale = Math.min(
            1,
            1280 / video.videoWidth,
            960 / video.videoHeight,
          );
          canvas.width = Math.round(video.videoWidth * captureScale);
          canvas.height = Math.round(video.videoHeight * captureScale);
          const context = canvas.getContext('2d');
          if (!context) {
            return null;
          }
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          return canvas.toDataURL('image/jpeg', 0.88);
        },
        restart: start,
      }),
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

    const displayFaceBox = landmarkFacePresent ? null : faceBox || projectedApiFaceBox;
    const faceOutline = displayFaceBox
      ? {
          width: displayFaceBox.width * 1.34,
          height: displayFaceBox.height * 1.72,
          left: displayFaceBox.x - displayFaceBox.width * 0.17,
          top: displayFaceBox.y - displayFaceBox.height * 0.34,
        }
      : null;
    const overlayLabel = faceOverlay?.label || 'Rosto detectado';
    const overlayTone = faceOverlay?.tone || 'tracking';
    const cameraStatusLabel = ready
      ? landmarkFacePresent
        ? faceOverlay?.tone === 'success'
          ? 'Rosto identificado'
          : 'Rosto enquadrado'
        : displayFaceBox
        ? overlayTone === 'success'
          ? 'Rosto identificado'
          : 'Rosto detectado'
        : landmarkState === 'loading'
          ? 'Preparando leitura'
        : 'Câmera ativa'
      : 'Iniciando câmera';

    return (
      <div className={`camera-view app-view-transition ${className}`}>
        <video ref={videoRef} className="h-full w-full object-cover" autoPlay muted playsInline />
        <canvas ref={canvasRef} className="hidden" />
        <canvas ref={landmarkCanvasRef} className="face-landmark-canvas" />

        {faceOutline && (
          <div
            className="face-outline face-track-overlay"
            data-tone={overlayTone}
            style={{
              left: `${faceOutline.left}px`,
              top: `${faceOutline.top}px`,
              width: `${faceOutline.width}px`,
              height: `${faceOutline.height}px`,
            }}
          >
            <div className={`face-track-label ${faceOutline.top < 34 ? 'face-track-label-inside' : ''}`}>
              {overlayLabel}
              {faceOverlay?.detail && <span>{faceOverlay.detail}</span>}
            </div>
            <svg viewBox="0 0 220 280" className="face-outline-vector">
              <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                <path strokeWidth="3" d="M110 15 C52 18 25 68 30 135 C35 212 72 260 110 265 C148 260 185 212 190 135 C195 68 168 18 110 15 Z" />
                <path strokeWidth="1.6" strokeOpacity="0.42" d="M78 62 C98 51 123 51 143 62" />
                <path strokeWidth="1.6" strokeOpacity="0.42" d="M75 218 C94 232 126 232 145 218" />
              </g>
            </svg>
          </div>
        )}

        <div className="camera-chip absolute left-3 top-3">
          <Camera size={15} />
          {cameraStatusLabel}
        </div>

        <button
          type="button"
          onClick={start}
          className="absolute right-3 top-3 grid h-11 w-11 place-items-center rounded-xl border border-white/20 bg-black/75 text-white backdrop-blur hover:border-white/40 hover:bg-black/90"
          title="Reiniciar câmera"
          aria-label="Reiniciar câmera"
        >
          <RefreshCcw size={15} />
        </button>

        {error && (
          <div className="absolute inset-x-4 bottom-4 rounded-lg bg-red-700 px-3 py-2 text-sm font-semibold text-white shadow-panel">
            {error}
          </div>
        )}
      </div>
    );
  },
);

CameraCapture.displayName = 'CameraCapture';
