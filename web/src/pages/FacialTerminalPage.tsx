import {
  Camera,
  Check,
  CheckCircle2,
  Clock3,
  Focus,
  MapPin,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  ShieldAlert,
  UserRoundCheck,
  WifiOff,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  CameraCapture,
  type CameraCaptureHandle,
  type FaceOverlayState,
  type FaceSourceBox,
} from '../components/CameraCapture';
import { apiClient } from '../services/api';
import type {
  AttendanceDecision,
  Employee,
  FaceAnalyzeResponse,
  FaceIdentifyResponse,
  PunchType,
  Worksite,
} from '../types/domain';

type TerminalMode =
  | 'starting'
  | 'ready'
  | 'scanning'
  | 'confirming'
  | 'submitting'
  | 'accepted'
  | 'review'
  | 'attention'
  | 'paused';

type TemporalRecognitionState = 'UNKNOWN' | 'POSSIBLE' | 'CONFIRMING' | 'CONFIRMED';

type TemporalEvidence = {
  employeeId: string;
  image: string;
  score: number;
  quality: number;
  capturedAt: number;
};

type LiveRecognition = {
  employeeId?: string | null;
  employeeName?: string | null;
  tone: FaceOverlayState['tone'];
  faceBox?: FaceIdentifyResponse['face_box'];
};

type RecentRecord = {
  id: string;
  employee: string;
  registration?: string | null;
  punchType?: PunchType | null;
  status: 'ACCEPTED' | 'MANUAL_REVIEW';
  occurredAt: Date;
};

const REQUIRED_STABLE_READINGS = 3;
const RECOGNITION_INTERVAL_MS = 850;
const TEMPORAL_WINDOW_MS = 4_000;
const TRANSIENT_MISS_GRACE_MS = 1_250;
const RESULT_HOLD_MS = 6_000;
const EMPLOYEE_COOLDOWN_MS = 45_000;

const punchLabels: Record<PunchType, string> = {
  ENTRY: 'Entrada',
  LUNCH_OUT: 'Saída para intervalo',
  LUNCH_IN: 'Retorno do intervalo',
  EXIT: 'Saída',
};

const initialRecognition: LiveRecognition = {
  tone: 'tracking',
};

function formatDate(value: Date) {
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  }).format(value);
}

function qualityLabel(analysis: FaceAnalyzeResponse | null) {
  if (!analysis || analysis.face_count === 0) return 'Aguardando rosto';
  if (analysis.face_count > 1) return 'Mais de uma pessoa';
  if (!analysis.accepted) return 'Ajuste necessário';
  if (analysis.quality_score >= 0.78) return 'Imagem boa';
  return 'Imagem adequada';
}

function guidanceForResult(result: FaceIdentifyResponse) {
  const reasons = new Set(result.reasons.map((reason) => reason.toUpperCase()));
  if (result.face_count === 0 || reasons.has('NO_FACE')) {
    return 'Aproxime-se e posicione o rosto dentro do enquadramento.';
  }
  if (result.face_count > 1 || reasons.has('MULTIPLE_FACES')) {
    return 'Mantenha apenas uma pessoa em frente à câmera.';
  }
  if (reasons.has('IMAGE_TOO_BLURRY')) {
    return 'Fique parado por um instante para melhorar a nitidez.';
  }
  if (reasons.has('UNDEREXPOSED') || reasons.has('LOW_CONTRAST')) {
    return 'O rosto está escuro. Procure uma área com mais luz.';
  }
  if (reasons.has('OVEREXPOSED')) {
    return 'Evite luz direta no rosto ou atrás da câmera.';
  }
  if (reasons.has('FACE_TOO_SMALL')) {
    return 'Aproxime-se um pouco mais da câmera.';
  }
  if (reasons.has('NO_COMPATIBLE_TEMPLATES')) {
    return 'Os cadastros faciais desta equipe precisam ser atualizados.';
  }
  if (reasons.has('AMBIGUOUS_FACE')) {
    return 'Permaneça de frente para a câmera enquanto confirmamos sua identidade.';
  }
  return 'Olhe de frente para a câmera e aguarde a confirmação.';
}

function attendanceReasonMessage(reasons: string[]) {
  const reasonSet = new Set(reasons.map((reason) => reason.toUpperCase()));
  if (reasonSet.has('NO_FACE')) {
    return 'Não encontramos o rosto no quadro. A câmera tentará novamente.';
  }
  if (reasonSet.has('MULTIPLE_FACES')) {
    return 'Mantenha apenas uma pessoa em frente à câmera.';
  }
  if (reasonSet.has('FACE_TOO_SMALL')) {
    return 'Aproxime-se um pouco mais para concluir o registro.';
  }
  if (reasonSet.has('IMAGE_TOO_BLURRY')) {
    return 'Fique parado por um instante para a câmera obter uma imagem mais nítida.';
  }
  if (
    reasonSet.has('UNDEREXPOSED')
    || reasonSet.has('LOW_CONTRAST')
    || reasonSet.has('OVEREXPOSED')
  ) {
    return 'A iluminação não está adequada. Evite contraluz e deixe o rosto mais visível.';
  }
  if (reasonSet.has('LOW_SIMILARITY') || reasonSet.has('EMPLOYEE_MISMATCH')) {
    return 'O rosto foi detectado, mas a identidade não ficou clara. Olhe de frente.';
  }
  if (reasonSet.has('AMBIGUOUS_FACE')) {
    return 'A identificação ficou ambígua. Permaneça de frente por mais um instante.';
  }
  if (reasonSet.has('NO_COMPATIBLE_TEMPLATES')) {
    return 'O cadastro facial deste funcionário precisa ser atualizado.';
  }
  if (reasonSet.has('OUT_OF_GEOFENCE')) {
    return 'Este terminal está fora da área configurada para a obra.';
  }
  if (reasonSet.has('INACTIVE_EMPLOYEE')) {
    return 'O cadastro deste funcionário não está ativo.';
  }
  if (reasonSet.has('MANUAL_REVIEW')) {
    return 'O registro foi recebido e será conferido pela equipe responsável.';
  }
  return 'Não foi possível concluir o registro. A câmera tentará novamente.';
}

export function FacialTerminalPage() {
  const cameraRef = useRef<CameraCaptureHandle | null>(null);
  const requestInFlightRef = useRef(false);
  const punchInFlightRef = useRef(false);
  const temporalEvidenceRef = useRef<TemporalEvidence[]>([]);
  const cooldownsRef = useRef(new Map<string, number>());
  const resultHoldUntilRef = useRef(0);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [worksites, setWorksites] = useState<Worksite[]>([]);
  const [worksiteId, setWorksiteId] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [autoEnabled, setAutoEnabled] = useState(true);
  const [mode, setMode] = useState<TerminalMode>('starting');
  const [analysis, setAnalysis] = useState<FaceAnalyzeResponse | null>(null);
  const [recognition, setRecognition] = useState<LiveRecognition>(initialRecognition);
  const [decision, setDecision] = useState<AttendanceDecision | null>(null);
  const [guidance, setGuidance] = useState('Iniciando a câmera...');
  const [stableReadings, setStableReadings] = useState(0);
  const [temporalState, setTemporalState] = useState<TemporalRecognitionState>('UNKNOWN');
  const [recentRecords, setRecentRecords] = useState<RecentRecord[]>([]);
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [clock, setClock] = useState(new Date());
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    apiClient
      .employees()
      .then((page) => setEmployees(page.items))
      .catch(() => setGuidance('Não foi possível carregar os funcionários.'));

    apiClient
      .worksites()
      .then((page) => {
        const active = page.items.filter((worksite) => worksite.active);
        setWorksites(active);
        setWorksiteId((current) => current || active[0]?.id || '');
      })
      .catch(() => setGuidance('Não foi possível carregar as obras.'));

    navigator.geolocation?.getCurrentPosition(
      (position) => {
        setLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      () => setLocation(null),
      { enableHighAccuracy: true, timeout: 8_000 },
    );
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    document.body.style.overflow = fullscreen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [fullscreen]);

  const selectedWorksite = worksites.find((worksite) => worksite.id === worksiteId);

  const submitAutomaticPunch = useCallback(async (
    employeeId: string,
    recognizedName?: string | null,
    evidenceImages: string[] = [],
  ) => {
    if (!worksiteId || punchInFlightRef.current) return;
    const images = evidenceImages.length
      ? evidenceImages.slice(-REQUIRED_STABLE_READINGS)
      : [cameraRef.current?.capture({ faceCrop: true })].filter((image): image is string => Boolean(image));
    if (images.length < REQUIRED_STABLE_READINGS) {
      setMode('attention');
      setGuidance('A câmera ainda não reuniu evidências suficientes. Permaneça por mais um instante.');
      return;
    }

    punchInFlightRef.current = true;
    setMode('submitting');
    setGuidance('Identidade confirmada. Registrando o ponto...');
    setStableReadings(REQUIRED_STABLE_READINGS);

    try {
      const result = await apiClient.punch({
        employee_id: employeeId,
        worksite_id: worksiteId,
        punch_type: null,
        location,
        face: { images_base64: images },
        offline_batch_id: `terminal-${crypto.randomUUID()}`,
      });
      setDecision(result);
      const employee = employees.find((item) => item.id === result.employee_id);
      const employeeName = result.employee_name || employee?.name || recognizedName || 'Funcionário';
      const resolvedEmployeeId = result.employee_id || employeeId;

      if (result.accepted) {
        cooldownsRef.current.set(resolvedEmployeeId, Date.now() + EMPLOYEE_COOLDOWN_MS);
        resultHoldUntilRef.current = Date.now() + RESULT_HOLD_MS;
        setMode('accepted');
        setGuidance(`${punchLabels[result.punch_type || 'ENTRY']} registrada com sucesso.`);
        setRecognition((current) => ({
          ...current,
          employeeId: resolvedEmployeeId,
          employeeName,
          tone: 'success',
        }));
        setRecentRecords((current) => [
          {
            id: result.record?.id || crypto.randomUUID(),
            employee: employeeName,
            registration: result.employee_registration || employee?.registration,
            punchType: result.punch_type,
            status: 'ACCEPTED' as const,
            occurredAt: new Date(),
          },
          ...current,
        ].slice(0, 5));
      } else if (result.status === 'MANUAL_REVIEW') {
        cooldownsRef.current.set(resolvedEmployeeId, Date.now() + EMPLOYEE_COOLDOWN_MS);
        resultHoldUntilRef.current = Date.now() + RESULT_HOLD_MS;
        setMode('review');
        setGuidance('O registro foi recebido e será conferido pela equipe responsável.');
        setRecentRecords((current) => [
          {
            id: result.record?.id || crypto.randomUUID(),
            employee: employeeName,
            registration: result.employee_registration || employee?.registration,
            punchType: result.punch_type,
            status: 'MANUAL_REVIEW' as const,
            occurredAt: new Date(),
          },
          ...current,
        ].slice(0, 5));
      } else {
        resultHoldUntilRef.current = Date.now() + 2_500;
        setMode('attention');
        setGuidance(attendanceReasonMessage(result.reasons));
      }
    } catch {
      resultHoldUntilRef.current = Date.now() + 4_000;
      setMode('attention');
      setGuidance('O serviço de ponto não respondeu. A câmera continuará tentando.');
    } finally {
      punchInFlightRef.current = false;
      temporalEvidenceRef.current = [];
      setTemporalState('UNKNOWN');
    }
  }, [employees, location, worksiteId]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    let timer = 0;

    if (!cameraReady) {
      setMode('starting');
      setGuidance('Iniciando a câmera...');
      return () => controller.abort();
    }
    if (!autoEnabled) {
      setMode('paused');
      setGuidance('Leitura pausada pelo operador.');
      return () => controller.abort();
    }
    if (!worksiteId) {
      setMode('attention');
      setGuidance('Selecione a obra onde este terminal está instalado.');
      return () => controller.abort();
    }

    const schedule = (delay = RECOGNITION_INTERVAL_MS) => {
      if (!cancelled) timer = window.setTimeout(scan, delay);
    };

    const scan = async () => {
      if (
        cancelled
        || requestInFlightRef.current
        || punchInFlightRef.current
      ) {
        schedule();
        return;
      }

      const holdRemaining = resultHoldUntilRef.current - Date.now();
      if (holdRemaining > 0) {
        schedule(Math.min(holdRemaining, RECOGNITION_INTERVAL_MS));
        return;
      }

      const image = cameraRef.current?.capture();
      if (!image) {
        setMode('starting');
        setGuidance('Aguardando imagem da câmera...');
        schedule();
        return;
      }

      requestInFlightRef.current = true;
      setMode('scanning');
      setGuidance('Posicione o rosto no enquadramento.');

      try {
        let result = await apiClient.identifyFace(image, worksiteId, controller.signal);
        let recognizedImage = image;
        const retryReasons = new Set(
          result.reasons.map((reason) => reason.toUpperCase()),
        );
        if (
          !result.matched
          && (
            retryReasons.has('NO_FACE')
            || retryReasons.has('FACE_TOO_SMALL')
            || retryReasons.has('LOW_DETECTION_CONFIDENCE')
          )
        ) {
          const focusedImage = cameraRef.current?.capture({
            faceCrop: true,
            sourceFaceBox: result.face_box
              ? {
                  x: result.face_box.x,
                  y: result.face_box.y,
                  width: result.face_box.width,
                  height: result.face_box.height,
                  sourceWidth: result.face_box.source_width,
                  sourceHeight: result.face_box.source_height,
                }
              : null,
          });
          if (focusedImage && focusedImage !== image) {
            result = await apiClient.identifyFace(
              focusedImage,
              worksiteId,
              controller.signal,
            );
            recognizedImage = focusedImage;
          }
        }
        if (cancelled) return;

        setAnalysis(result);
        setDecision(null);
        setRecognition({
          employeeId: result.employee_id,
          employeeName: result.employee_name,
          tone: result.matched ? 'tracking' : result.accepted ? 'warning' : 'tracking',
          faceBox: result.face_box,
        });

        if (result.matched && result.face_box) {
          const evidenceCrop = cameraRef.current?.capture({
            faceCrop: true,
            sourceFaceBox: {
              x: result.face_box.x,
              y: result.face_box.y,
              width: result.face_box.width,
              height: result.face_box.height,
              sourceWidth: result.face_box.source_width,
              sourceHeight: result.face_box.source_height,
            },
          });
          if (evidenceCrop) recognizedImage = evidenceCrop;
        }

        if (!result.matched || !result.employee_id) {
          const now = Date.now();
          const recentEvidence = temporalEvidenceRef.current.filter(
            (item) => now - item.capturedAt <= TEMPORAL_WINDOW_MS,
          );
          const lastEvidence = recentEvidence[recentEvidence.length - 1];
          const transientMiss = lastEvidence
            && now - lastEvidence.capturedAt <= TRANSIENT_MISS_GRACE_MS
            && result.reasons.some((reason) => [
              'NO_FACE',
              'FACE_TOO_SMALL',
              'IMAGE_TOO_BLURRY',
              'LOW_DETECTION_CONFIDENCE',
            ].includes(reason.toUpperCase()));
          if (transientMiss) {
            temporalEvidenceRef.current = recentEvidence;
            setStableReadings(recentEvidence.length);
            setTemporalState(recentEvidence.length > 1 ? 'CONFIRMING' : 'POSSIBLE');
          } else {
            temporalEvidenceRef.current = [];
            setStableReadings(0);
            setTemporalState('UNKNOWN');
          }
          setMode(result.reasons.some((reason) => reason.toUpperCase() === 'NO_COMPATIBLE_TEMPLATES')
            ? 'attention'
            : 'scanning');
          setGuidance(guidanceForResult(result));
          return;
        }

        const cooldownUntil = cooldownsRef.current.get(result.employee_id) || 0;
        if (cooldownUntil > Date.now()) {
          temporalEvidenceRef.current = [];
          setStableReadings(0);
          setTemporalState('UNKNOWN');
          setMode('ready');
          setGuidance(`Ponto de ${result.employee_name || 'funcionário'} já registrado. Próxima pessoa pode se aproximar.`);
          return;
        }

        const now = Date.now();
        const currentEvidence = temporalEvidenceRef.current.filter(
          (item) => (
            item.employeeId === result.employee_id
            && now - item.capturedAt <= TEMPORAL_WINDOW_MS
          ),
        );
        currentEvidence.push({
          employeeId: result.employee_id,
          image: recognizedImage,
          score: result.similarity_score || 0,
          quality: result.quality_score,
          capturedAt: now,
        });
        const scoreValues = currentEvidence.map((item) => item.score);
        const scoreSpread = Math.max(...scoreValues) - Math.min(...scoreValues);
        const stableEvidence = scoreSpread <= 0.12
          ? currentEvidence.slice(-REQUIRED_STABLE_READINGS)
          : [currentEvidence[currentEvidence.length - 1]];
        temporalEvidenceRef.current = stableEvidence;
        const nextCount = stableEvidence.length;
        setStableReadings(Math.min(nextCount, REQUIRED_STABLE_READINGS));
        setTemporalState(
          nextCount >= REQUIRED_STABLE_READINGS
            ? 'CONFIRMED'
            : nextCount > 1
              ? 'CONFIRMING'
              : 'POSSIBLE',
        );
        setMode('confirming');
        setGuidance(
          nextCount >= REQUIRED_STABLE_READINGS
            ? 'Identidade confirmada.'
            : `Fique parado por mais um instante (${nextCount}/${REQUIRED_STABLE_READINGS}).`,
        );

        if (nextCount >= REQUIRED_STABLE_READINGS) {
          await submitAutomaticPunch(
            result.employee_id,
            result.employee_name,
            stableEvidence.map((item) => item.image),
          );
        }
      } catch (error) {
        if (!cancelled && !(error instanceof DOMException && error.name === 'AbortError')) {
          temporalEvidenceRef.current = [];
          setStableReadings(0);
          setTemporalState('UNKNOWN');
          setMode('attention');
          setGuidance('Reconhecimento temporariamente indisponível. Tentaremos novamente.');
          setRecognition({ tone: 'warning' });
        }
      } finally {
        requestInFlightRef.current = false;
        schedule();
      }
    };

    schedule(350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
      requestInFlightRef.current = false;
    };
  }, [autoEnabled, cameraReady, submitAutomaticPunch, worksiteId]);

  const faceOverlay = useMemo<FaceOverlayState>(() => ({
    label: mode === 'confirming'
      ? temporalState === 'POSSIBLE' ? 'Possível correspondência' : 'Confirmando identidade'
      : mode === 'accepted'
        ? 'Registro concluído'
        : 'Posicione o rosto',
    detail: mode === 'confirming'
      ? `${temporalState} · ${stableReadings}/${REQUIRED_STABLE_READINGS}`
      : undefined,
    tone: mode === 'accepted'
      ? 'success'
      : mode === 'attention' || mode === 'review'
        ? 'warning'
        : recognition.tone,
  }), [mode, recognition.tone, stableReadings, temporalState]);

  const detectedFaceBox = useMemo<FaceSourceBox | null>(() => (
    recognition.faceBox
      ? {
          x: recognition.faceBox.x,
          y: recognition.faceBox.y,
          width: recognition.faceBox.width,
          height: recognition.faceBox.height,
          sourceWidth: recognition.faceBox.source_width,
          sourceHeight: recognition.faceBox.source_height,
        }
      : null
  ), [recognition.faceBox]);

  const resultPresentation = useMemo(() => {
    if (mode === 'accepted') {
      return {
        icon: CheckCircle2,
        title: decision?.employee_name || recognition.employeeName || 'Ponto registrado',
        detail: guidance,
        tone: 'success',
      };
    }
    if (mode === 'review') {
      return {
        icon: ShieldAlert,
        title: 'Registro em conferência',
        detail: guidance,
        tone: 'warning',
      };
    }
    if (mode === 'attention') {
      return {
        icon: XCircle,
        title: 'Atenção necessária',
        detail: guidance,
        tone: 'danger',
      };
    }
    if (mode === 'paused') {
      return {
        icon: Pause,
        title: 'Leitura pausada',
        detail: guidance,
        tone: 'neutral',
      };
    }
    if (mode === 'submitting') {
      return {
        icon: Clock3,
        title: 'Registrando ponto',
        detail: guidance,
        tone: 'neutral',
      };
    }
    if (mode === 'confirming') {
      return {
        icon: UserRoundCheck,
        title: recognition.employeeName || 'Confirmando identidade',
        detail: guidance,
        tone: 'neutral',
      };
    }
    return {
      icon: Focus,
      title: 'Aguardando aproximação',
      detail: guidance,
      tone: 'neutral',
    };
  }, [decision?.employee_name, guidance, mode, recognition.employeeName]);

  const ResultIcon = resultPresentation.icon;
  const cameraClass = fullscreen ? 'h-[calc(100vh-164px)] min-h-[560px]' : 'h-[clamp(440px,62vh,690px)]';

  const content = (
    <div className="terminal-shell">
      <section className="terminal-camera-card">
        <div className="terminal-toolbar">
          <div className="terminal-toolbar-identity">
            <div>
              <strong className="block text-sm">Terminal de acesso</strong>
              <span className="mt-0.5 block text-xs text-steel">
                {selectedWorksite ? `${selectedWorksite.code} · ${selectedWorksite.name}` : 'Obra não configurada'}
              </span>
            </div>
            <span className={`status-pill ${autoEnabled ? 'status-pill-online' : 'status-pill-neutral'}`}>
              <span className="status-dot status-dot-pulse" />
              {autoEnabled ? 'Leitura automática' : 'Pausado'}
            </span>
          </div>
          <div className="terminal-toolbar-actions">
            <label className="sr-only" htmlFor="terminal-worksite">Obra deste terminal</label>
            <select
              id="terminal-worksite"
              value={worksiteId}
              onChange={(event) => setWorksiteId(event.target.value)}
              className="input-field"
            >
              <option value="">Selecionar obra</option>
              {worksites.map((worksite) => (
                <option key={worksite.id} value={worksite.id}>
                  {worksite.code} · {worksite.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setAutoEnabled((current) => !current)}
              className="icon-button"
              aria-label={autoEnabled ? 'Pausar leitura automática' : 'Iniciar leitura automática'}
              title={autoEnabled ? 'Pausar leitura' : 'Iniciar leitura'}
            >
              {autoEnabled ? <Pause size={17} /> : <Play size={17} />}
            </button>
            <button
              type="button"
              onClick={() => setFullscreen((current) => !current)}
              className="icon-button"
              aria-label={fullscreen ? 'Sair da tela cheia' : 'Usar tela cheia'}
              title={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
            >
              {fullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
            </button>
          </div>
        </div>

        <div className="terminal-camera-frame">
          <CameraCapture
            ref={cameraRef}
            className={cameraClass}
            faceOverlay={faceOverlay}
            detectedFaceBox={detectedFaceBox}
            onReadyChange={setCameraReady}
          />
        </div>

        <div className="terminal-status-strip">
          <div className="terminal-primary-status">
            <div
              className={`terminal-status-symbol ${
                mode === 'accepted'
                  ? 'is-success'
                  : mode === 'attention' || mode === 'review'
                    ? 'is-warning'
                    : ''
              }`}
            >
              {mode === 'accepted'
                ? <Check size={20} />
                : mode === 'attention'
                  ? <ShieldAlert size={20} />
                  : <Focus size={20} />}
            </div>
            <div className="min-w-0" aria-live="polite">
              <strong>{resultPresentation.title}</strong>
              <span>{guidance}</span>
            </div>
          </div>

          <div className="terminal-signal-grid">
            <div className="terminal-signal">
              <span>Câmera</span>
              <strong>{cameraReady ? 'Disponível' : 'Iniciando'}</strong>
            </div>
            <div className="terminal-signal">
              <span>Enquadramento</span>
              <strong>{analysis?.face_count === 1 ? 'Rosto detectado' : 'Aguardando'}</strong>
            </div>
            <div className="terminal-signal">
              <span>Imagem</span>
              <strong>{qualityLabel(analysis)}</strong>
            </div>
            <div className="terminal-signal">
              <span>Confirmação</span>
              <strong>{temporalState}</strong>
            </div>
          </div>
        </div>
      </section>

      <aside className="terminal-side">
        <section className="terminal-panel">
          <div className="terminal-clock">
            {clock.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </div>
          <div className="terminal-date">{formatDate(clock)}</div>
        </section>

        <section className="terminal-panel">
          <div className="terminal-result" data-tone={resultPresentation.tone} aria-live="polite">
            <div className="terminal-result-icon">
              <ResultIcon size={25} strokeWidth={1.8} />
            </div>
            <h3>{resultPresentation.title}</h3>
            <p>{resultPresentation.detail}</p>
            {(mode === 'confirming' || mode === 'submitting') && (
              <div className="terminal-progress" aria-label="Progresso da confirmação">
                <span style={{ width: `${Math.max(12, (stableReadings / REQUIRED_STABLE_READINGS) * 100)}%` }} />
              </div>
            )}
          </div>
        </section>

        <section className="terminal-panel">
          <div className="flex items-center justify-between gap-3">
            <div>
              <strong className="block text-sm">Registros desta sessão</strong>
              <span className="mt-1 block text-xs text-steel">Últimos pontos confirmados neste terminal</span>
            </div>
            <span className="status-pill status-pill-neutral">{recentRecords.length}</span>
          </div>

          {recentRecords.length === 0 ? (
            <div className="terminal-empty-events">
              Os registros aparecerão aqui após a confirmação.
            </div>
          ) : (
            <div className="terminal-events">
              {recentRecords.map((record) => (
                <div key={record.id} className="terminal-event">
                  <span className="terminal-event-icon">
                    {record.status === 'ACCEPTED' ? <Check size={15} /> : <Clock3 size={15} />}
                  </span>
                  <span className="min-w-0">
                    <strong>{record.employee}</strong>
                    <span>
                      {record.registration || 'Sem matrícula'} · {record.punchType ? punchLabels[record.punchType] : 'Registro'}
                    </span>
                  </span>
                  <time>{record.occurredAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time>
                </div>
              ))}
            </div>
          )}
        </section>

        {!navigator.onLine && (
          <section className="terminal-panel flex items-start gap-3 text-sm text-red-700 dark:text-red-300">
            <WifiOff size={18} className="mt-0.5 shrink-0" />
            <span>Sem conexão. Nenhum registro será confirmado enquanto o serviço estiver indisponível.</span>
          </section>
        )}

        <section className="terminal-panel flex items-start gap-3">
          <MapPin size={18} className="mt-0.5 shrink-0 text-steel" />
          <div>
            <strong className="block text-xs">Operação sem toque</strong>
            <p className="mt-1 text-xs leading-5 text-steel">
              A pessoa só precisa olhar para a câmera. O movimento do ponto é definido automaticamente pelo histórico.
            </p>
          </div>
        </section>
      </aside>
    </div>
  );

  return fullscreen
    ? <div className="facial-terminal-fullscreen">{content}</div>
    : content;
}
