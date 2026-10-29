import {
  CheckCircle2,
  Clock3,
  Focus,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  ShieldAlert,
  UserRoundCheck,
  WifiOff,
  XCircle,
} from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  CameraCapture,
  type CameraCaptureHandle,
  type FaceBox as CameraFaceBox,
  type FaceOverlayState,
  type FaceOverlayTarget,
  type FaceSourceBox,
} from '../components/CameraCapture';
import { apiClient } from '../services/api';
import { usePresentationMode } from '../presentation/PresentationContext';
import {
  shouldOfferPresentationResult,
  type PresentationEmailStatus,
  type PresentationParticipantResult,
  type PresentationResult,
} from '../presentation/presentationResult';
import type {
  AttendanceDecision,
  Employee,
  FaceAnalyzeResponse,
  PunchType,
  Worksite,
} from '../types/domain';
import { formatInAppTimeZone, parseApiDate } from '../utils/dateTime';
import { publishAttendancePulse } from '../utils/attendancePulse';
import { readTerminalWorksiteId, saveTerminalWorksiteId } from '../utils/terminalPreferences';

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
  faceBox?: FaceAnalyzeResponse['face_box'];
};

type RecentRecord = {
  id: string;
  employee: string;
  registration?: string | null;
  punchType?: PunchType | null;
  status: 'ACCEPTED' | 'MANUAL_REVIEW';
  occurredAt: Date;
  email: PresentationEmailStatus;
};

type PunchCandidate = {
  employeeId?: string | null;
  recognizedName?: string | null;
  image: string;
  faceBox?: FaceAnalyzeResponse['face_box'];
  localFaceBox?: CameraFaceBox;
};

const RECOGNITION_INTERVAL_MS = 80;
const SINGLE_RESULT_HOLD_MS = 1_400;
const GROUP_RESULT_HOLD_MS = 1_200;
// Em grupo, os rostos que faltam são relidos quase de imediato.
const PARTIAL_RESULT_HOLD_MS = 100;
const MAX_FACES_PER_SCAN = 5;
// Depois do primeiro reconhecimento, a apresentação ainda espera um pouco:
// o detector do navegador costuma encontrar o segundo rosto alguns quadros
// depois do primeiro, e a contagem local oscila quando alguém vira o rosto.
const GROUP_PRESENTATION_MIN_WAIT_MS = 900;
// Tempo de espera pelos demais rostos (por exemplo, alguém sem cadastro)
// antes de abrir com quem já foi reconhecido. Cresce com o tamanho do grupo:
// cada rosto a mais no quadro ganha tempo extra para ser registrado.
const GROUP_PRESENTATION_WAIT_MS = 4_000;
const GROUP_PRESENTATION_WAIT_PER_FACE_MS = 2_500;
// Enquanto alguém novo continua sendo registrado, o grupo segue aberto.
const GROUP_PRESENTATION_PROGRESS_GRACE_MS = 3_000;
const GROUP_PRESENTATION_MAX_WAIT_MS = 20_000;
const GROUP_PRESENTATION_CHECK_MS = 150;

type PresentationDraft = {
  participants: PresentationParticipantResult[];
  startedAt: number;
  lastProgressAt: number;
  // Maior número de rostos visto desde o primeiro reconhecimento; uma queda
  // momentânea na contagem não pode encerrar a espera pelo grupo.
  maxFaces: number;
};
const RETRY_RESULT_HOLD_MS = 180;
const SERVICE_RETRY_HOLD_MS = 1_200;

function faceBoxIou(left: CameraFaceBox, right: CameraFaceBox) {
  const intersectionLeft = Math.max(left.x, right.x);
  const intersectionTop = Math.max(left.y, right.y);
  const intersectionRight = Math.min(left.x + left.width, right.x + right.width);
  const intersectionBottom = Math.min(left.y + left.height, right.y + right.height);
  const intersection = Math.max(0, intersectionRight - intersectionLeft)
    * Math.max(0, intersectionBottom - intersectionTop);
  const union = left.width * left.height + right.width * right.height - intersection;
  return union > 0 ? intersection / union : 0;
}

const loadPresentationShow = () => import('../presentation/PresentationShow');
const PresentationShow = lazy(() => loadPresentationShow().then((module) => ({
  default: module.PresentationShow,
})));

function emailStatus(result: AttendanceDecision): PresentationEmailStatus {
  if (result.email_notification_sent) return 'sent';
  if (result.email_notification_queued) return 'queued';
  return 'none';
}

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
  return formatInAppTimeZone(value, { weekday: 'long', day: '2-digit', month: 'long' });
}

function formatClock(value: Date) {
  return formatInAppTimeZone(value, { hour: '2-digit', minute: '2-digit' });
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
    return 'Dois cadastros ficaram parecidos nesta leitura. Olhe de frente para uma nova comparação.';
  }
  if (reasonSet.has('INSUFFICIENT_TEMPORAL_EVIDENCE')) {
    return 'A imagem variou durante a leitura. A câmera tentará uma nova sequência automaticamente.';
  }
  if (reasonSet.has('TEMPORAL_IDENTITY_INCONSISTENT')) {
    return 'As imagens da sequência não representam a mesma pessoa. Reposicione-se diante da câmera.';
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
  const presentation = usePresentationMode();
  const cameraRef = useRef<CameraCaptureHandle | null>(null);
  const requestInFlightRef = useRef(false);
  const punchInFlightRef = useRef(false);
  const localFacePresentRef = useRef(false);
  const localFaceCountRef = useRef(0);
  const resultHoldUntilRef = useRef(0);
  const triggerScanRef = useRef<(() => void) | null>(null);
  const awaitingFaceExitRef = useRef(false);
  const completedFaceBoxesRef = useRef<CameraFaceBox[]>([]);
  const presentationDraftRef = useRef<PresentationDraft | null>(null);
  const presentationTimerRef = useRef(0);
  const flushPresentationDraftRef = useRef<() => void>(() => undefined);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [worksites, setWorksites] = useState<Worksite[]>([]);
  const [worksiteId, setWorksiteId] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [autoEnabled, setAutoEnabled] = useState(true);
  const [mode, setMode] = useState<TerminalMode>('starting');
  const [analysis, setAnalysis] = useState<FaceAnalyzeResponse | null>(null);
  const [recognition, setRecognition] = useState<LiveRecognition>(initialRecognition);
  const [recognizedFaceTargets, setRecognizedFaceTargets] = useState<FaceOverlayTarget[]>([]);
  const [decision, setDecision] = useState<AttendanceDecision | null>(null);
  const [guidance, setGuidance] = useState('Iniciando a câmera…');
  const [recentRecords, setRecentRecords] = useState<RecentRecord[]>([]);
  const [clock, setClock] = useState(new Date());
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    // navigator.onLine read during render never updated the "Sem conexão" badge.
    const updateConnection = () => setOnline(navigator.onLine);
    window.addEventListener('online', updateConnection);
    window.addEventListener('offline', updateConnection);
    return () => {
      window.removeEventListener('online', updateConnection);
      window.removeEventListener('offline', updateConnection);
    };
  }, []);
  const [fullscreen, setFullscreen] = useState(false);
  const [presentationResult, setPresentationResult] = useState<PresentationResult | null>(null);
  const presentationExperienceOpen = presentation.active && presentationResult !== null;

  useEffect(() => {
    if (!presentation.active) {
      window.clearTimeout(presentationTimerRef.current);
      presentationDraftRef.current = null;
      setPresentationResult(null);
      return;
    }
    // Baixa a apresentação antes do primeiro reconhecimento: ela abre na hora.
    void loadPresentationShow().catch(() => undefined);
  }, [presentation.active]);

  useEffect(() => {
    // Aquece o container e os modelos antes de o primeiro funcionário aparecer.
    // A readiness aquece modelo e conexao com o banco em uma unica chamada.
    const warmFaceRuntime = () => {
      void apiClient.faceReadiness().catch(() => undefined);
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
        setWorksiteId((current) => {
          if (active.some((worksite) => worksite.id === current)) return current;
          const stored = readTerminalWorksiteId();
          const selected = active.some((worksite) => worksite.id === stored)
            ? stored
            : active[0]?.id || '';
          saveTerminalWorksiteId(selected);
          return selected;
        });
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

  // Abre a apresentação com todos os rostos reconhecidos até agora.
  const flushPresentationDraft = useCallback(() => {
    window.clearTimeout(presentationTimerRef.current);
    const draft = presentationDraftRef.current;
    presentationDraftRef.current = null;
    if (!draft || !shouldOfferPresentationResult(presentation.active, draft.participants)) return;
    setPresentationResult({
      worksiteName: selectedWorksite?.name || 'Obra selecionada',
      worksiteCode: selectedWorksite?.code,
      participants: draft.participants,
    });
  }, [presentation.active, selectedWorksite?.code, selectedWorksite?.name]);

  useEffect(() => {
    flushPresentationDraftRef.current = flushPresentationDraft;
  }, [flushPresentationDraft]);

  // Abre a apresentação quando todos os rostos vistos já foram registrados
  // (respeitando a espera mínima) ou quando o prazo do grupo acaba.
  const checkPresentationDraft = useCallback(() => {
    window.clearTimeout(presentationTimerRef.current);
    const draft = presentationDraftRef.current;
    if (!draft) return;
    draft.maxFaces = Math.max(draft.maxFaces, localFaceCountRef.current);
    const now = Date.now();
    const elapsed = now - draft.startedAt;
    const groupSize = Math.min(draft.maxFaces, MAX_FACES_PER_SCAN);
    const everyoneRegistered = draft.participants.length >= groupSize;
    const deadline = Math.min(
      draft.startedAt + GROUP_PRESENTATION_MAX_WAIT_MS,
      Math.max(
        draft.startedAt + GROUP_PRESENTATION_WAIT_MS
          + GROUP_PRESENTATION_WAIT_PER_FACE_MS * Math.max(0, groupSize - 1),
        draft.lastProgressAt + GROUP_PRESENTATION_PROGRESS_GRACE_MS,
      ),
    );
    if (
      now >= deadline
      || (everyoneRegistered && elapsed >= GROUP_PRESENTATION_MIN_WAIT_MS && !punchInFlightRef.current)
    ) {
      flushPresentationDraftRef.current();
      return;
    }
    presentationTimerRef.current = window.setTimeout(() => checkPresentationDraft(), GROUP_PRESENTATION_CHECK_MS);
  }, []);

  useEffect(() => () => window.clearTimeout(presentationTimerRef.current), []);

  const handleLocalFacePresence = useCallback((present: boolean) => {
    localFacePresentRef.current = present;
  }, []);
  const handleLocalFaceCount = useCallback((count: number) => {
    const wasPresent = localFacePresentRef.current;
    const previousCount = localFaceCountRef.current;
    localFacePresentRef.current = count > 0;
    localFaceCountRef.current = count;
    if (presentationDraftRef.current) {
      presentationDraftRef.current.maxFaces = Math.max(presentationDraftRef.current.maxFaces, count);
    }
    if (count === 0) {
      awaitingFaceExitRef.current = false;
      completedFaceBoxesRef.current = [];
      setRecognizedFaceTargets([]);
    } else if (count > completedFaceBoxesRef.current.length) {
      awaitingFaceExitRef.current = false;
    }
    if ((!wasPresent && count > 0) || count > previousCount) triggerScanRef.current?.();
  }, []);
  const closePresentationResult = useCallback(() => {
    // A apresentação dura mais que a janela de duplicidade do servidor. Quem
    // continua diante da câmera ao fim dela não pode virar uma nova batida
    // (por exemplo, "saída para o intervalo"): a leitura só rearma quando o
    // quadro esvaziar ou alguém novo entrar.
    if (localFacePresentRef.current) awaitingFaceExitRef.current = true;
    setPresentationResult(null);
  }, []);

  const submitAutomaticPunches = useCallback(async (candidates: PunchCandidate[], signal?: AbortSignal) => {
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
      ? `Reconhecendo e registrando ${validCandidates.length} pessoas…`
      : 'Reconhecendo e registrando o ponto…');

    try {
      const scanId = crypto.randomUUID();
      const occurredAt = new Date().toISOString();
      const batch = await apiClient.punchBatch(validCandidates.map((candidate, index) => ({
        employee_id: candidate.employeeId || null,
        worksite_id: worksiteId,
        punch_type: null,
        face: {
          image_base64: candidate.image,
          images_base64: [],
        },
        offline_batch_id: `terminal-${scanId}-${index + 1}`,
        occurred_at: occurredAt,
      })), signal);
      // A cancelled scan may have committed on the server. Do not present its
      // response in a different worksite or after the operator pauses the scan.
      if (signal?.aborted) return 0;
      const completedRecords: RecentRecord[] = [];
      const newlyCompletedRecords: RecentRecord[] = [];
      let successfulRecognition: LiveRecognition | null = null;

      batch.decisions.forEach((result, index) => {
        const candidate = validCandidates[index];
        if (!candidate) return;
        const employee = employees.find((item) => item.id === result.employee_id);
        const employeeName = result.employee_name
          || employee?.name
          || candidate.recognizedName
          || 'Funcionário';
        const resolvedEmployeeId = result.employee_id || candidate.employeeId || '';
        if (result.status !== 'ACCEPTED' && result.status !== 'MANUAL_REVIEW') return;
        // Only a persisted record can confirm attendance. Never fabricate a
        // record identifier or timestamp from a recognition-only response.
        if (!result.record?.id || !result.record.occurred_at) return;

        const completedRecord = {
          id: result.record.id,
          employee: employeeName,
          registration: result.employee_registration || employee?.registration,
          punchType: result.punch_type,
          status: result.status,
          occurredAt: parseApiDate(result.record.occurred_at),
          email: emailStatus(result),
        } satisfies RecentRecord;
        completedRecords.push(completedRecord);
        if (!result.reasons.includes('duplicate_capture')) {
          newlyCompletedRecords.push(completedRecord);
        }
        if (candidate.localFaceBox) {
          const recognizedBox = candidate.localFaceBox;
          completedFaceBoxesRef.current = [
            ...completedFaceBoxesRef.current.filter((box) => (
              faceBoxIou(box, recognizedBox) < 0.2
            )),
            recognizedBox,
          ];
          setRecognizedFaceTargets((current) => [
            ...current.filter((target) => faceBoxIou(target.box, recognizedBox) < 0.2),
            {
              box: recognizedBox,
              label: employeeName,
              detail: result.accepted ? 'Identificado' : 'Em conferência',
              tone: result.accepted ? 'success' : 'warning',
            },
          ]);
        }
        successfulRecognition ||= {
          employeeId: resolvedEmployeeId,
          employeeName,
          tone: result.accepted ? 'success' : 'warning',
          faceBox: candidate.faceBox,
        };
      });

      const completed = completedRecords.length;
      setDecision(batch.decisions.find((result) => !result.accepted) || batch.decisions[0] || null);
      if (newlyCompletedRecords.length) {
        setRecentRecords((current) => [...newlyCompletedRecords, ...current].slice(0, 5));
      }
      if (successfulRecognition) setRecognition(successfulRecognition);

      if (completed > 0) {
        if (newlyCompletedRecords.length) {
          publishAttendancePulse(
            worksiteId,
            newlyCompletedRecords.length,
            newlyCompletedRecords.filter((record) => record.email !== 'none').length,
          );
        }
        const allCompleted = completed === validCandidates.length;
        if (allCompleted && completedFaceBoxesRef.current.length >= localFaceCountRef.current) {
          awaitingFaceExitRef.current = true;
        }
        // A apresentação espera todos os rostos do quadro serem registrados
        // (ou o prazo do grupo acabar) para mostrar o nome de todos juntos.
        let groupStillForming = false;
        if (presentation.active) {
          const registeredRecords = completedRecords;
          const draft = presentationDraftRef.current;
          // Uma batida duplicada sozinha não reabre a apresentação, mas entra
          // no grupo quando há alguém novo sendo apresentado.
          if (draft || newlyCompletedRecords.length) {
            const nextDraft = draft || {
              participants: [],
              startedAt: Date.now(),
              lastProgressAt: Date.now(),
              maxFaces: localFaceCountRef.current,
            };
            for (const record of registeredRecords) {
              if (nextDraft.participants.some((participant) => (
                participant.id === record.id || participant.name === record.employee
              ))) continue;
              nextDraft.lastProgressAt = Date.now();
              nextDraft.participants.push({
                id: record.id,
                name: record.employee,
                registration: record.registration,
                punchType: record.punchType,
                occurredAt: record.occurredAt,
                email: record.email,
              });
            }
            nextDraft.maxFaces = Math.max(nextDraft.maxFaces, localFaceCountRef.current, validCandidates.length);
            presentationDraftRef.current = nextDraft;
            groupStillForming = nextDraft.participants.length < Math.min(nextDraft.maxFaces, MAX_FACES_PER_SCAN);
          }
        }

        // Enquanto o grupo se forma, a câmera continua lendo sem pausa.
        resultHoldUntilRef.current = Date.now() + (
          presentationDraftRef.current
            ? PARTIAL_RESULT_HOLD_MS
            : allCompleted
              ? validCandidates.length > 1 ? GROUP_RESULT_HOLD_MS : SINGLE_RESULT_HOLD_MS
              : PARTIAL_RESULT_HOLD_MS
        );
        setMode(batch.manual_review > 0 ? 'review' : allCompleted ? 'accepted' : 'attention');

        if (groupStillForming) {
          const draft = presentationDraftRef.current;
          const registeredCount = draft?.participants.length || 0;
          setMode('confirming');
          setGuidance(`${registeredCount} de ${draft?.maxFaces || registeredCount} pessoas reconhecidas. Aguardando os demais rostos…`);
        } else if (validCandidates.length > 1) {
          setGuidance(allCompleted
            ? `${completed} pontos registrados nesta leitura.`
            : `${completed} de ${validCandidates.length} pontos foram registrados; os demais rostos serão tentados novamente.`);
        } else {
          const result = batch.decisions[0];
          setGuidance(result?.reasons.includes('duplicate_capture')
            ? 'Ponto já registrado há menos de 1 minuto. Aguarde antes de tentar novamente.'
            : result?.status === 'MANUAL_REVIEW'
              ? 'O registro foi recebido e será conferido pela equipe responsável.'
              : `${punchLabels[result?.punch_type || 'ENTRY']} registrada com sucesso.`);
        }
        checkPresentationDraft();
        return completed;
      }

      resultHoldUntilRef.current = Date.now() + RETRY_RESULT_HOLD_MS;
      setMode('attention');
      setGuidance(attendanceReasonMessage(batch.decisions[0]?.reasons || []));
      return 0;
    } catch {
      if (signal?.aborted) return 0;
      resultHoldUntilRef.current = Date.now() + SERVICE_RETRY_HOLD_MS;
      setMode('attention');
      setGuidance('O serviço de ponto não respondeu. A câmera continuará tentando.');
      return 0;
    } finally {
      punchInFlightRef.current = false;
    }
  }, [checkPresentationDraft, employees, presentation.active, worksiteId]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    let timer = 0;

    if (!cameraReady) {
      setMode(cameraError ? 'attention' : 'starting');
      setGuidance(cameraError || 'Iniciando a câmera…');
      return () => controller.abort();
    }
    if (presentationExperienceOpen) {
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
        || (awaitingFaceExitRef.current && localFacePresentRef.current)
      ) {
        schedule();
        return;
      }

      const holdRemaining = resultHoldUntilRef.current - Date.now();
      if (holdRemaining > 0) {
        schedule(Math.min(holdRemaining, RECOGNITION_INTERVAL_MS));
        return;
      }

      const capturedFaces = localFacePresentRef.current
        ? cameraRef.current?.captureFaceSamples({ limit: MAX_FACES_PER_SCAN }) || []
        : [];
      const pendingFaces = capturedFaces.filter(({ box }) => (
        completedFaceBoxesRef.current.every((completed) => faceBoxIou(completed, box) < 0.2)
      ));
      if (!pendingFaces.length) {
        setMode(localFacePresentRef.current ? 'ready' : 'starting');
        setGuidance(localFacePresentRef.current ? 'Rosto já registrado nesta leitura.' : 'Aguardando rosto…');
        schedule();
        return;
      }

      requestInFlightRef.current = true;
      setMode('scanning');
      setGuidance(pendingFaces.length > 1
        ? `Reconhecendo ${pendingFaces.length} pessoas ao mesmo tempo…`
        : 'Reconhecendo o rosto…');

      try {
        setAnalysis(null);
        setDecision(null);
        await submitAutomaticPunches(pendingFaces.map(({ image, box }) => ({
          image,
          localFaceBox: box,
        })), controller.signal);
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
    schedule(40);
    return () => {
      triggerScanRef.current = null;
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
      requestInFlightRef.current = false;
    };
  }, [autoEnabled, cameraReady, cameraError, presentationExperienceOpen, submitAutomaticPunches, worksiteId]);

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
  const latestRecord = recentRecords[0];
  const content = (
    <div className="terminal-shell" data-mode={mode}>
      <h1 className="sr-only">Ponto automático</h1>
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
              onChange={(event) => {
                const nextWorksiteId = event.target.value;
                setWorksiteId(nextWorksiteId);
                saveTerminalWorksiteId(nextWorksiteId);
              }}
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
              aria-pressed={autoEnabled}
              title={autoEnabled ? 'Pausar leitura' : 'Iniciar leitura'}
            >
              {autoEnabled ? <Pause size={17} /> : <Play size={17} />}
            </button>
            <button
              type="button"
              onClick={() => setFullscreen((current) => !current)}
              className="icon-button"
              aria-label={fullscreen ? 'Sair da tela cheia' : 'Usar tela cheia'}
              aria-pressed={fullscreen}
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
            fitMode="contain"
            faceOverlay={faceOverlay}
            faceOverlayTargets={recognizedFaceTargets}
            detectedFaceBox={detectedFaceBox}
            onReadyChange={setCameraReady}
            onErrorChange={setCameraError}
            onFacePresenceChange={handleLocalFacePresence}
            onFaceCountChange={handleLocalFaceCount}
            trackingPaused={presentationExperienceOpen}
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
              <ResultIcon size={20} />
            </div>
            <div className="min-w-0" role="status" aria-live="polite" aria-atomic="true">
              <strong>{resultPresentation.title}</strong>
              <span>{guidance}</span>
            </div>
          </div>
          <div className="terminal-compact-meta">
            <time className="terminal-compact-clock" dateTime={clock.toISOString()}>
              <strong>{formatClock(clock)}</strong>
              <span>{formatDate(clock)}</span>
            </time>
            {latestRecord && (
              <div className="terminal-latest-record">
                <span>Último registro</span>
                <strong>{latestRecord.employee}</strong>
                <small>
                  {latestRecord.punchType ? punchLabels[latestRecord.punchType] : 'Ponto'} ·{' '}
                  {formatClock(latestRecord.occurredAt)}
                  {latestRecord.email === 'sent' ? ' · E-mail enviado' : latestRecord.email === 'queued' ? ' · E-mail a caminho' : ''}
                </small>
              </div>
            )}
            {!online && (
              <span className="terminal-offline-note">
                <WifiOff size={16} /> Sem conexão
              </span>
            )}
          </div>
        </div>
      </section>
    </div>
  );

  return (
    <>
      {fullscreen ? <div className="facial-terminal-fullscreen">{content}</div> : content}
      {presentationExperienceOpen && presentationResult && (
        <Suspense fallback={null}>
          <PresentationShow
            result={presentationResult}
            onClose={closePresentationResult}
          />
        </Suspense>
      )}
    </>
  );
}
