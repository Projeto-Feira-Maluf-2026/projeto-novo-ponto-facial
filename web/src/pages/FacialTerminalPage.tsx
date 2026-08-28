import {
  Camera,
  Check,
  CheckCircle2,
  Clock3,
  Focus,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  ScanFace,
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
import { parseApiDate } from '../utils/dateTime';

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

type PunchCandidate = {
  employeeId: string;
  recognizedName?: string | null;
  image: string;
  faceBox?: FaceIdentifyResponse['face_box'];
};

const RECOGNITION_INTERVAL_MS = 160;
const SINGLE_RESULT_HOLD_MS = 2_200;
const GROUP_RESULT_HOLD_MS = 1_200;
const PARTIAL_RESULT_HOLD_MS = 450;
const EMPLOYEE_COOLDOWN_MS = 45_000;
const MAX_FACES_PER_SCAN = 5;

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
  if (analysis.face_count > 1) return `${analysis.face_count} rostos detectados`;
  if (!analysis.accepted) return 'Ajuste necessário';
  if (analysis.quality_score >= 0.78) return 'Imagem boa';
  return 'Imagem adequada';
}

function guidanceForResult(result: FaceIdentifyResponse) {
  const reasons = new Set(result.reasons.map((reason) => reason.toUpperCase()));
  if (result.face_count === 0 || reasons.has('NO_FACE')) {
    return 'Mostre o rosto à câmera. A leitura será feita automaticamente.';
  }
  if (result.face_count > 1 || reasons.has('MULTIPLE_FACES')) {
    return 'Mantenham os rostos visíveis enquanto a câmera separa cada leitura.';
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
    return 'Mantenha o rosto visível enquanto a câmera tenta uma nova leitura.';
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
    return 'Os rostos foram localizados e serão processados separadamente na próxima leitura.';
  }
  if (reasonSet.has('FACE_TOO_SMALL')) {
    return 'Mantenha o rosto visível enquanto a câmera tenta concluir o registro.';
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
  const localFacePresentRef = useRef(false);
  const cooldownsRef = useRef(new Map<string, number>());
  const resultHoldUntilRef = useRef(0);
  const triggerScanRef = useRef<(() => void) | null>(null);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [worksites, setWorksites] = useState<Worksite[]>([]);
  const [worksiteId, setWorksiteId] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [localFaceCount, setLocalFaceCount] = useState(0);
  const [autoEnabled, setAutoEnabled] = useState(true);
  const [mode, setMode] = useState<TerminalMode>('starting');
  const [analysis, setAnalysis] = useState<FaceAnalyzeResponse | null>(null);
  const [recognition, setRecognition] = useState<LiveRecognition>(initialRecognition);
  const [decision, setDecision] = useState<AttendanceDecision | null>(null);
  const [guidance, setGuidance] = useState('Iniciando a câmera...');
  const [recentRecords, setRecentRecords] = useState<RecentRecord[]>([]);
  const [clock, setClock] = useState(new Date());
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    // Aquece o container e os modelos antes de o primeiro funcionário aparecer.
    // O ping periódico reduz cold starts em terminais que ficam abertos o dia inteiro.
    const warmFaceRuntime = () => {
      void apiClient.faceCapabilities().catch(() => undefined);
    };
    warmFaceRuntime();
    const warmupTimer = window.setInterval(warmFaceRuntime, 3 * 60_000);

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

    return () => window.clearInterval(warmupTimer);
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
  const handleLocalFacePresence = useCallback((present: boolean) => {
    localFacePresentRef.current = present;
  }, []);
  const handleLocalFaceCount = useCallback((count: number) => {
    const wasPresent = localFacePresentRef.current;
    localFacePresentRef.current = count > 0;
    setLocalFaceCount(count);
    if (!wasPresent && count > 0) triggerScanRef.current?.();
  }, []);

  const submitAutomaticPunches = useCallback(async (candidates: PunchCandidate[]) => {
    if (!worksiteId || punchInFlightRef.current || !candidates.length) return 0;
    const validCandidates = candidates.filter((candidate) => Boolean(candidate.image));
    if (!validCandidates.length) {
      setMode('attention');
      setGuidance('Não foi possível preservar as fotos reconhecidas. A câmera tentará novamente.');
      return 0;
    }

    punchInFlightRef.current = true;
    setMode('submitting');
    setGuidance(validCandidates.length > 1
      ? `Identidades confirmadas. Registrando ${validCandidates.length} pontos...`
      : 'Identidade confirmada. Registrando o ponto...');

    try {
      const scanId = crypto.randomUUID();
      const occurredAt = new Date().toISOString();
      const batch = await apiClient.punchBatch(validCandidates.map((candidate, index) => ({
        employee_id: candidate.employeeId,
        worksite_id: worksiteId,
        punch_type: null,
        face: { image_base64: candidate.image },
        offline_batch_id: `terminal-${scanId}-${index + 1}`,
        occurred_at: occurredAt,
      })));
      const completedRecords: RecentRecord[] = [];
      let successfulRecognition: LiveRecognition | null = null;

      batch.decisions.forEach((result, index) => {
        const candidate = validCandidates[index];
        if (!candidate) return;
        const employee = employees.find((item) => item.id === result.employee_id);
        const employeeName = result.employee_name
          || employee?.name
          || candidate.recognizedName
          || 'Funcionário';
        const resolvedEmployeeId = result.employee_id || candidate.employeeId;
        if (result.status !== 'ACCEPTED' && result.status !== 'MANUAL_REVIEW') return;

        cooldownsRef.current.set(resolvedEmployeeId, Date.now() + EMPLOYEE_COOLDOWN_MS);
        completedRecords.push({
          id: result.record?.id || crypto.randomUUID(),
          employee: employeeName,
          registration: result.employee_registration || employee?.registration,
          punchType: result.punch_type,
          status: result.status,
          occurredAt: result.record?.occurred_at
            ? parseApiDate(result.record.occurred_at)
            : new Date(),
        });
        successfulRecognition ||= {
          employeeId: resolvedEmployeeId,
          employeeName,
          tone: result.accepted ? 'success' : 'warning',
          faceBox: candidate.faceBox,
        };
      });

      const completed = completedRecords.length;
      setDecision(batch.decisions.find((result) => !result.accepted) || batch.decisions[0] || null);
      if (completedRecords.length) {
        setRecentRecords((current) => [...completedRecords, ...current].slice(0, 5));
      }
      if (successfulRecognition) setRecognition(successfulRecognition);

      if (completed > 0) {
        const allCompleted = completed === validCandidates.length;
        resultHoldUntilRef.current = Date.now() + (
          allCompleted
            ? validCandidates.length > 1 ? GROUP_RESULT_HOLD_MS : SINGLE_RESULT_HOLD_MS
            : PARTIAL_RESULT_HOLD_MS
        );
        setMode(batch.manual_review > 0 ? 'review' : allCompleted ? 'accepted' : 'attention');
        if (validCandidates.length > 1) {
          setGuidance(allCompleted
            ? `${completed} pontos registrados nesta leitura.`
            : `${completed} de ${validCandidates.length} pontos foram registrados; os demais rostos serão tentados novamente.`);
        } else {
          const result = batch.decisions[0];
          setGuidance(result?.status === 'MANUAL_REVIEW'
            ? 'O registro foi recebido e será conferido pela equipe responsável.'
            : `${punchLabels[result?.punch_type || 'ENTRY']} registrada com sucesso.`);
        }
        return completed;
      }

      resultHoldUntilRef.current = Date.now() + 2_500;
      setMode('attention');
      setGuidance(attendanceReasonMessage(batch.decisions[0]?.reasons || []));
      return 0;
    } catch {
      resultHoldUntilRef.current = Date.now() + 4_000;
      setMode('attention');
      setGuidance('O serviço de ponto não respondeu. A câmera continuará tentando.');
      return 0;
    } finally {
      punchInFlightRef.current = false;
    }
  }, [employees, worksiteId]);

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

      const croppedFaceImages = localFacePresentRef.current
        ? cameraRef.current?.captureFaces({ limit: MAX_FACES_PER_SCAN }) || []
        : [];
      const fallbackImage = croppedFaceImages.length === 0
        ? cameraRef.current?.capture({ faceCrop: false })
        : null;
      const images = croppedFaceImages.length > 0
        ? croppedFaceImages
        : fallbackImage
          ? [fallbackImage]
          : [];
      if (!images.length) {
        setMode('starting');
        setGuidance('Aguardando imagem da câmera...');
        schedule();
        return;
      }

      requestInFlightRef.current = true;
      setMode('scanning');
      setGuidance(images.length > 1
        ? `Reconhecendo ${images.length} pessoas ao mesmo tempo...`
        : 'Reconhecendo o rosto...');

      try {
        const identifyCapture = async (initialImage: string) => {
          let result = await apiClient.identifyFace(initialImage, worksiteId, controller.signal);
          let recognizedImage = initialImage;
          const retryReasons = new Set(result.reasons.map((reason) => reason.toUpperCase()));
          if (
            images.length === 1
            && croppedFaceImages.length === 0
            && !result.matched
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
            if (focusedImage && focusedImage !== initialImage) {
              result = await apiClient.identifyFace(focusedImage, worksiteId, controller.signal);
              recognizedImage = focusedImage;
            }
          }
          return { result, image: recognizedImage };
        };

        const identifiedCaptures = images.length > 1
          ? (await apiClient.identifyFaces(images, worksiteId, controller.signal)).results.map((result, index) => ({
              result,
              image: images[index],
            }))
          : await Promise.all(images.map(identifyCapture));
        if (cancelled) return;
        if (!identifiedCaptures.length) {
          throw new Error('Nenhum rosto pôde ser analisado.');
        }

        const primaryCapture = identifiedCaptures.find(({ result }) => result.matched)
          || identifiedCaptures.find(({ result }) => result.accepted)
          || identifiedCaptures[0];
        const result = primaryCapture.result;

        setAnalysis(result);
        setDecision(null);

        const matchesByEmployee = new Map<string, typeof primaryCapture>();
        identifiedCaptures.forEach((capture) => {
          if (capture.result.matched && capture.result.employee_id) {
            matchesByEmployee.set(capture.result.employee_id, capture);
          }
        });
        const matches = [...matchesByEmployee.values()];

        if (!matches.length) {
          setRecognition({
            employeeId: null,
            employeeName: null,
            tone: result.accepted ? 'warning' : 'tracking',
            faceBox: result.face_box,
          });
          setMode(result.reasons.some((reason) => reason.toUpperCase() === 'NO_COMPATIBLE_TEMPLATES')
            ? 'attention'
            : 'scanning');
          setGuidance(images.length > 1
            ? 'Os rostos foram detectados, mas as identidades ainda não foram confirmadas.'
            : guidanceForResult(result));
          return;
        }

        const firstMatch = matches[0].result;
        setRecognition({
          employeeId: firstMatch.employee_id,
          employeeName: firstMatch.employee_name,
          tone: 'tracking',
          faceBox: firstMatch.face_box,
        });

        const pendingMatches = matches.filter(({ result: match }) => (
          (cooldownsRef.current.get(match.employee_id || '') || 0) <= Date.now()
        ));
        if (!pendingMatches.length) {
          setMode('ready');
          setGuidance(matches.length > 1
            ? 'Os pontos destas pessoas já foram registrados. A câmera está pronta para uma nova leitura.'
            : `Ponto de ${firstMatch.employee_name || 'funcionário'} já registrado. A câmera está pronta para outra pessoa.`);
          return;
        }

        setMode('confirming');
        setGuidance(pendingMatches.length > 1
          ? `Registrando ${pendingMatches.length} pessoas na mesma leitura...`
          : 'Identidade localizada. Registrando o ponto...');
        await submitAutomaticPunches(pendingMatches.flatMap((capture) => {
          const match = capture.result;
          return match.employee_id
            ? [{
                employeeId: match.employee_id,
                recognizedName: match.employee_name,
                image: capture.image,
                faceBox: match.face_box,
              }]
            : [];
        }));
      } catch (error) {
        if (!cancelled && !(error instanceof DOMException && error.name === 'AbortError')) {
          setMode('attention');
          setGuidance('Reconhecimento temporariamente indisponível. Tentaremos novamente.');
          setRecognition({ tone: 'warning' });
        }
      } finally {
        requestInFlightRef.current = false;
        schedule();
      }
    };

    triggerScanRef.current = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(scan, 0);
    };
    schedule(350);
    return () => {
      triggerScanRef.current = null;
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
      requestInFlightRef.current = false;
    };
  }, [autoEnabled, cameraReady, submitAutomaticPunches, worksiteId]);

  const faceOverlay = useMemo<FaceOverlayState>(() => ({
    label: mode === 'confirming'
      ? 'Identidade localizada'
      : mode === 'accepted'
        ? 'Registro concluído'
        : 'Posicione o rosto',
    tone: mode === 'accepted'
      ? 'success'
      : mode === 'attention' || mode === 'review'
        ? 'warning'
        : recognition.tone,
  }), [mode, recognition.tone]);

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
        title: 'Registro não concluído',
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
      title: 'Aguardando rosto',
      detail: guidance,
      tone: 'neutral',
    };
  }, [decision?.employee_name, guidance, mode, recognition.employeeName]);

  const ResultIcon = resultPresentation.icon;
  const cameraClass = fullscreen ? 'h-[calc(100vh-164px)] min-h-[560px]' : 'h-[clamp(440px,62vh,690px)]';
  const flowStage = !cameraReady
    ? 1
    : mode === 'confirming'
      ? 3
      : mode === 'submitting'
        ? 4
        : mode === 'accepted'
          ? 5
          : 2;
  const flowSteps = [
    { label: 'Câmera', detail: cameraReady ? 'Disponível' : 'Iniciando', icon: Camera },
    { label: 'Reconhecimento', detail: localFaceCount > 1 ? `${localFaceCount} rostos localizados` : analysis?.face_count === 1 ? 'Rosto localizado' : 'Aguardando rosto', icon: Focus },
    { label: 'Identificado', detail: recognition.employeeName || 'Aguardando identidade', icon: UserRoundCheck },
    { label: 'Registrado', detail: mode === 'accepted' ? 'Ponto confirmado' : 'Aguardando confirmação', icon: CheckCircle2 },
  ];
  const content = (
    <div className="terminal-shell" data-mode={mode}>
      <h1 className="sr-only">Ponto automático</h1>
      <section className="terminal-flow" aria-label="Etapas do registro facial">
        {flowSteps.map((step, index) => {
          const Icon = step.icon;
          const stepNumber = index + 1;
          const state = flowStage > stepNumber
            ? 'complete'
            : flowStage === stepNumber
              ? 'active'
              : 'pending';
          return (
            <div key={step.label} className="terminal-flow-step" data-state={state}>
              <span className="terminal-flow-icon">
                {state === 'complete' ? <Check size={17} /> : <Icon size={17} />}
              </span>
              <span><strong>{step.label}</strong><small>{step.detail}</small></span>
              {index < flowSteps.length - 1 && <i aria-hidden="true" />}
            </div>
          );
        })}
      </section>
      <section className="terminal-camera-card" data-mode={mode}>
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

        <div className="terminal-camera-frame" data-mode={mode}>
          <CameraCapture
            ref={cameraRef}
            className={cameraClass}
            faceOverlay={faceOverlay}
            detectedFaceBox={detectedFaceBox}
            onReadyChange={setCameraReady}
            onFacePresenceChange={handleLocalFacePresence}
            onFaceCountChange={handleLocalFaceCount}
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
            <div className="terminal-signal"><span>Câmera</span><strong>{cameraReady ? 'Disponível' : 'Iniciando'}</strong></div>
            <div className="terminal-signal"><span>Enquadramento</span><strong>{localFaceCount > 1 ? `${localFaceCount} rostos detectados` : analysis?.face_count === 1 ? 'Rosto detectado' : 'Aguardando'}</strong></div>
            <div className="terminal-signal"><span>Imagem</span><strong>{localFaceCount > 1 ? `${localFaceCount} leituras separadas` : qualityLabel(analysis)}</strong></div>
            <div className="terminal-signal"><span>Identificação</span><strong>{recognition.employeeName || 'Aguardando'}</strong></div>
          </div>
        </div>
      </section>

      <aside className="terminal-side">
        <section className="terminal-panel">
          <div className="terminal-clock">{clock.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
          <div className="terminal-date">{formatDate(clock)}</div>
        </section>
        <section className="terminal-panel">
          <div className="terminal-result" data-tone={resultPresentation.tone} data-mode={mode} aria-live="polite">
            <div className="terminal-result-icon">
              <ResultIcon size={25} strokeWidth={1.8} />
            </div>
            <h3>{resultPresentation.title}</h3>
            <p>{resultPresentation.detail}</p>
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
          <ScanFace size={18} className="mt-0.5 shrink-0 text-steel" />
          <div>
            <strong className="block text-xs">Leitura sem toque</strong>
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
