import {
  AlertCircle,
  Camera,
  Check,
  CheckCircle2,
  Edit3,
  LoaderCircle,
  Pause,
  Play,
  Search,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { CameraCapture, type CameraCaptureHandle } from '../components/CameraCapture';
import { DataTable } from '../components/DataTable';
import { playModalExit } from '../animations/motion';
import { useModalMotion } from '../animations/useMotion';
import { apiClient } from '../services/api';
import type {
  Employee,
  EnrollmentSampleResponse,
  EnrollmentSessionResponse,
  Worksite,
} from '../types/domain';

const initialForm = {
  registration: '',
  name: '',
  email: '',
  document: '',
  phone: '',
  worksite_id: '',
};

const employeeStatusLabels: Record<Employee['status'], string> = {
  ACTIVE: 'Ativo',
  ON_LEAVE: 'Afastado',
  INACTIVE: 'Inativo',
};

const employeeStatusFilters = [
  { value: 'ALL' as const, label: 'Todos' },
  { value: 'ACTIVE' as const, label: 'Ativos' },
  { value: 'ON_LEAVE' as const, label: 'Afastados' },
  { value: 'INACTIVE' as const, label: 'Inativos' },
];

function enrollmentError(error: unknown, fallback: string) {
  const payload = error as {
    code?: string;
    message?: string;
    response?: { data?: { error?: { code?: string; message?: string; details?: { reasons?: string[] } } } };
  };
  const apiError = payload.response?.data?.error;
  if (apiError?.code === 'FACE_RUNTIME_NOT_INSTALLED') {
    return 'O backend de IA facial não está publicado. Configure VITE_FACE_API_URL com uma URL HTTPS acessível por todos os computadores.';
  }
  if (!apiError) {
    if (payload.message === 'API_ROUTE_RETURNED_HTML') {
      return 'A URL configurada respondeu com o site em vez da API. Verifique VITE_FACE_API_URL.';
    }
    if (payload.code === 'ERR_NETWORK') {
      return 'Não foi possível acessar o backend facial. Verifique a URL HTTPS, o CORS e se o serviço está online.';
    }
    return fallback;
  }
  const reasons = apiError.details?.reasons;
  const suffix = reasons?.length ? ` (${reasons.join(', ')})` : '';
  return `${apiError.message || fallback}${apiError.code ? ` [${apiError.code}]` : ''}${suffix}`;
}

function friendlyCaptureFeedback(instruction: string, reasons: string[]) {
  const reasonSet = new Set(reasons.map((reason) => reason.toUpperCase()));
  if (reasonSet.has('FACE_OUT_OF_FRAME')) return 'Mantenha testa, olhos e queixo visíveis.';
  if (reasonSet.has('FACE_OFF_CENTER')) return 'Mova o rosto um pouco para o centro.';
  if (reasonSet.has('FACE_TOO_SMALL')) return 'Aproxime-se um pouco da câmera.';
  if (reasonSet.has('FACE_TOO_CLOSE')) return 'Afaste-se um pouco da câmera.';
  if (reasonSet.has('IMAGE_TOO_BLURRY')) return 'Fique parado por um instante.';
  if (reasonSet.has('UNDEREXPOSED') || reasonSet.has('LOW_CONTRAST')) {
    return 'Procure uma posição com mais luz no rosto.';
  }
  if (reasonSet.has('OVEREXPOSED')) return 'Evite luz direta sobre o rosto.';
  if (reasonSet.has('TURN_TOO_FAR')) return 'Volte um pouco o rosto.';
  if (reasonSet.has('LOOK_UP_TOO_FAR')) return 'Abaixe um pouco o queixo.';
  if (reasonSet.has('DUPLICATE_BURST_FRAMES')) return 'Mantenha a posição por mais um instante.';
  return instruction || 'Ajuste o rosto e aguarde uma nova tentativa.';
}

export function EmployeesPage() {
  const cameraRef = useRef<CameraCaptureHandle | null>(null);
  const enrollmentModalRef = useRef<HTMLDivElement>(null);
  const enrollmentCloseButtonRef = useRef<HTMLButtonElement>(null);
  const enrollmentOpenerRef = useRef<HTMLElement | null>(null);
  const enrollmentClosingRef = useRef(false);
  const captureInFlightRef = useRef(false);
  const finalizeInFlightRef = useRef(false);
  const autoCaptureNotBeforeRef = useRef(0);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [worksites, setWorksites] = useState<Worksite[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'ALL' | Employee['status']>('ALL');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [enrolling, setEnrolling] = useState<Employee | null>(null);
  const [enrollmentSession, setEnrollmentSession] = useState<EnrollmentSessionResponse | null>(null);
  const [acceptedSamples, setAcceptedSamples] = useState(0);
  const [enrollmentReady, setEnrollmentReady] = useState(false);
  const [sampleResult, setSampleResult] = useState<EnrollmentSampleResponse | null>(null);
  const [capturePreviews, setCapturePreviews] = useState<string[]>([]);
  const [enrollmentFeedback, setEnrollmentFeedback] = useState('');
  const [enrollSaving, setEnrollSaving] = useState(false);
  const [enrollmentCameraReady, setEnrollmentCameraReady] = useState(false);
  const [enrollmentFacePresent, setEnrollmentFacePresent] = useState(false);
  const [autoCaptureEnabled, setAutoCaptureEnabled] = useState(true);
  const [captureRejected, setCaptureRejected] = useState(false);
  useModalMotion(enrollmentModalRef, enrolling?.id ?? null);

  const loadEmployees = () => {
    apiClient
      .employees()
      .then((page) => setEmployees(page.items))
      .catch(() => setMessage('Entre novamente e verifique se a API está online.'));
  };

  useEffect(() => {
    loadEmployees();
    apiClient
      .worksites()
      .then((page) => setWorksites(page.items))
      .catch(() => undefined);
  }, []);

  const filtered = useMemo(
    () =>
      employees.filter((employee) => {
        const matchesQuery = `${employee.registration} ${employee.name}`.toLowerCase().includes(query.toLowerCase());
        const matchesStatus = status === 'ALL' || employee.status === status;
        return matchesQuery && matchesStatus;
      }),
    [employees, query, status],
  );

  const setField = (field: keyof typeof initialForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const onCreate = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      await apiClient.createEmployee({
        registration: form.registration,
        name: form.name,
        email: form.email || null,
        document: form.document || null,
        phone: form.phone || null,
        worksite_ids: form.worksite_id ? [form.worksite_id] : [],
        status: 'ACTIVE',
      });
      setForm(initialForm);
      setShowForm(false);
      setMessage('Funcionário cadastrado.');
      loadEmployees();
    } catch {
      setMessage('Não foi possível cadastrar o funcionário.');
    } finally {
      setSaving(false);
    }
  };

  const openEnrollment = async (employee: Employee) => {
    enrollmentOpenerRef.current = document.activeElement as HTMLElement | null;
    captureInFlightRef.current = false;
    finalizeInFlightRef.current = false;
    autoCaptureNotBeforeRef.current = Date.now() + 1_000;
    setEnrolling(employee);
    setEnrollmentSession(null);
    setAcceptedSamples(0);
    setEnrollmentReady(false);
    setSampleResult(null);
    setCapturePreviews([]);
    setEnrollmentFeedback('Preparando sessão biométrica...');
    setEnrollmentCameraReady(false);
    setEnrollmentFacePresent(false);
    setAutoCaptureEnabled(true);
    setCaptureRejected(false);
    setMessage('');
    setEnrollSaving(true);
    try {
      const capabilities = await apiClient.faceCapabilities();
      if (!capabilities.provider_ready) {
        setCaptureRejected(true);
        setEnrollmentFeedback(
          'O backend de IA facial não está disponível neste deploy. Configure VITE_FACE_API_URL com a URL HTTPS do backend em container.',
        );
        return;
      }
      const started = await apiClient.startFaceEnrollment(employee.id);
      setEnrollmentSession(started);
      setEnrollmentFeedback('Entre no enquadramento e olhe naturalmente. A coleta será automática.');
    } catch (error) {
      setEnrollmentFeedback(enrollmentError(error, 'Não foi possível iniciar a sessão de cadastro facial.'));
    } finally {
      setEnrollSaving(false);
    }
  };

  const closeEnrollment = useCallback((cancelSession = true) => {
    if (enrollmentClosingRef.current) return;
    if (cancelSession && enrolling && enrollmentSession) {
      void apiClient.cancelFaceEnrollment(enrolling.id, enrollmentSession.session_id).catch(() => undefined);
    }
    captureInFlightRef.current = false;
    finalizeInFlightRef.current = false;
    enrollmentClosingRef.current = true;
    setAutoCaptureEnabled(false);
    setEnrollmentFacePresent(false);

    playModalExit(enrollmentModalRef.current, () => {
      enrollmentClosingRef.current = false;
      setEnrolling(null);
      setEnrollmentSession(null);
      setAcceptedSamples(0);
      setEnrollmentReady(false);
      setSampleResult(null);
      setCapturePreviews([]);
      setEnrollmentFeedback('');
      setEnrollmentCameraReady(false);
      setEnrollmentFacePresent(false);
      setCaptureRejected(false);
      enrollmentOpenerRef.current?.focus();
    });
  }, [enrolling, enrollmentSession]);

  useEffect(() => {
    const dialog = enrollmentModalRef.current;
    if (!enrolling || !dialog) return undefined;
    enrollmentCloseButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeEnrollment();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), select:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      )).filter((element) => !element.hasAttribute('hidden'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener('keydown', handleKeyDown);
    return () => dialog.removeEventListener('keydown', handleKeyDown);
  }, [closeEnrollment, enrolling]);

  const captureFace = useCallback(async () => {
    if (!enrolling || !enrollmentSession || captureInFlightRef.current) {
      setEnrollmentFeedback('A sessão facial ainda não está pronta.');
      return;
    }

    captureInFlightRef.current = true;
    setCaptureRejected(false);
    setEnrollSaving(true);
    setEnrollmentFeedback('Analisando nitidez, luz e variação facial...');
    try {
      const image = cameraRef.current?.capture({ faceCrop: true });
      if (!image) throw new Error('camera_not_ready');
      const result = await apiClient.collectFaceEnrollmentSample(
        enrolling.id,
        enrollmentSession.session_id,
        { image_base64: image, captured_at: new Date().toISOString() },
      );
      setSampleResult(result);
      setAcceptedSamples(result.accepted_samples);
      setEnrollmentReady(result.ready);
      if (result.accepted) {
        setCapturePreviews((current) => [...current, image].slice(-7));
        autoCaptureNotBeforeRef.current = Date.now() + 620;
        setEnrollmentFeedback(result.instruction);
      } else {
        setCaptureRejected(true);
        autoCaptureNotBeforeRef.current = Date.now() + 760;
        setEnrollmentFeedback(friendlyCaptureFeedback(result.instruction, result.reasons));
      }
    } catch (error) {
      setCaptureRejected(true);
      autoCaptureNotBeforeRef.current = Date.now() + 1_200;
      setEnrollmentFeedback(enrollmentError(error, 'Captura rejeitada. Ajuste o rosto e tente novamente.'));
    } finally {
      captureInFlightRef.current = false;
      setEnrollSaving(false);
    }
  }, [enrolling, enrollmentSession]);

  const submitEnrollment = useCallback(async () => {
    if (
      !enrolling
      || !enrollmentSession
      || !enrollmentReady
      || finalizeInFlightRef.current
    ) {
      setEnrollmentFeedback('Aguarde a coleta de amostras consistentes.');
      return;
    }
    finalizeInFlightRef.current = true;
    setEnrollSaving(true);
    setCaptureRejected(false);
    setEnrollmentFeedback('Validando a consistência das imagens...');
    setMessage('');
    try {
      const result = await apiClient.finalizeFaceEnrollment(
        enrolling.id,
        enrollmentSession.session_id,
      );
      setMessage(`Face cadastrada: ${result.templates_created} templates, qualidade ${Math.round(result.quality_average * 100)}%.`);
      closeEnrollment(false);
      apiClient.employees().then((page) => setEmployees(page.items)).catch(() => undefined);
    } catch (error) {
      setCaptureRejected(true);
      setEnrollmentFeedback(enrollmentError(error, 'A consistência final foi rejeitada. Continue a coleta por alguns instantes.'));
    } finally {
      finalizeInFlightRef.current = false;
      setEnrollSaving(false);
    }
  }, [closeEnrollment, enrolling, enrollmentReady, enrollmentSession]);

  useEffect(() => {
    if (
      !autoCaptureEnabled
      || !enrolling
      || !enrollmentSession
      || !enrollmentCameraReady
      || !enrollmentFacePresent
      || enrollSaving
      || enrollmentReady
    ) {
      return undefined;
    }

    const delay = Math.max(420, autoCaptureNotBeforeRef.current - Date.now());
    const timer = window.setTimeout(() => {
      void captureFace();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [
    autoCaptureEnabled,
    captureFace,
    enrollSaving,
    enrollmentReady,
    enrolling,
    enrollmentCameraReady,
    enrollmentFacePresent,
    enrollmentSession,
  ]);

  useEffect(() => {
    if (
      !enrollmentSession
      || !enrollmentReady
      || enrollSaving
      || captureRejected
      || finalizeInFlightRef.current
    ) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      void submitEnrollment();
    }, 600);
    return () => window.clearTimeout(timer);
  }, [captureRejected, enrollSaving, enrollmentReady, enrollmentSession, submitEnrollment]);

  const enrollmentStepCount = enrollmentSession?.target_samples ?? 5;
  const enrollmentComplete = enrollmentReady;
  const enrollmentProgress = Math.round(
    (sampleResult?.progress ?? (acceptedSamples / Math.max(enrollmentStepCount, 1))) * 100,
  );

  return (
    <div className="app-view-transition space-y-5">
      <section className="page-actions">
        <button
          onClick={() => setShowForm((value) => !value)}
          className="btn btn-primary"
        >
          <UserPlus size={18} />
          Adicionar funcionário
        </button>
      </section>

      {message && (
        <div className="feedback-banner app-view-transition" role="status">
          {message}
        </div>
      )}

      {showForm && (
        <form onSubmit={onCreate} className="form-panel app-view-transition md:grid-cols-2 xl:grid-cols-3">
          <label className="field-label">
            <span>Matrícula</span>
            <input value={form.registration} onChange={(event) => setField('registration', event.target.value)} required className="input-field" />
          </label>
          <label className="field-label">
            <span>Nome</span>
            <input value={form.name} onChange={(event) => setField('name', event.target.value)} required className="input-field" />
          </label>
          <label className="field-label">
            <span>Email</span>
            <input type="email" value={form.email} onChange={(event) => setField('email', event.target.value)} className="input-field" />
          </label>
          <label className="field-label">
            <span>Documento</span>
            <input value={form.document} onChange={(event) => setField('document', event.target.value)} className="input-field" />
          </label>
          <label className="field-label">
            <span>Telefone</span>
            <input value={form.phone} onChange={(event) => setField('phone', event.target.value)} className="input-field" />
          </label>
          <label className="field-label">
            <span>Obra</span>
            <select value={form.worksite_id} onChange={(event) => setField('worksite_id', event.target.value)} className="input-field">
              <option value="">Sem obra</option>
              {worksites.map((worksite) => (
                <option key={worksite.id} value={worksite.id}>
                  {worksite.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end gap-2 md:col-span-2 xl:col-span-3">
            <button disabled={saving} className="btn btn-primary">
              <UserPlus size={18} />
              {saving ? 'Salvando' : 'Salvar funcionário'}
            </button>
          </div>
        </form>
      )}

      <section className="toolbar-panel app-view-transition md:grid-cols-[1fr_auto]">
        <label className="search-field">
          <Search size={17} className="text-steel" />
          <input
            aria-label="Buscar funcionário"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full bg-transparent text-sm outline-none"
            placeholder="Buscar por nome ou matrícula"
          />
        </label>
        <div className="segmented-control">
          {employeeStatusFilters.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setStatus(item.value)}
              className="segmented-button"
              data-active={status === item.value}
              aria-pressed={status === item.value}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      <DataTable
        ariaLabel="Funcionários cadastrados"
        rows={filtered}
        columns={[
          { key: 'registration', header: 'Matrícula' },
          { key: 'name', header: 'Nome' },
          { key: 'email', header: 'Email' },
          {
            key: 'status',
            header: 'Status',
            render: (row) => (
              <span className={`status-pill ${row.status === 'ACTIVE' ? 'status-pill-online' : row.status === 'ON_LEAVE' ? 'status-pill-warn' : 'status-pill-neutral'}`}>
                <span className="status-dot" />
                {employeeStatusLabels[row.status]}
              </span>
            ),
          },
          {
            key: 'face',
            header: 'Face',
            render: (row) => (
              <span className="inline-flex items-center gap-2 text-sm font-semibold">
                {row.consent_biometric_at && !row.biometric_reenrollment_required ? <CheckCircle2 size={16} className="text-limeSafe" /> : <Camera size={16} className="text-steel" />}
                {row.biometric_reenrollment_required ? 'Recadastro' : row.consent_biometric_at ? 'Ativa' : 'Pendente'}
              </span>
            ),
          },
          {
            key: 'actions',
            header: '',
            render: (row) => (
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => openEnrollment(row)} className="icon-button" title="Cadastrar face" aria-label={`Cadastrar face de ${row.name}`}>
                  <Camera size={16} />
                </button>
                <button type="button" className="icon-button" title="Editar" aria-label={`Editar ${row.name}`}>
                  <Edit3 size={16} />
                </button>
                <button type="button" className="icon-button text-red-700 dark:text-red-300" title="Inativar" aria-label={`Inativar ${row.name}`}>
                  <Trash2 size={16} />
                </button>
              </div>
            ),
          },
        ]}
      />

      {enrolling && (
        <div ref={enrollmentModalRef} className="modal-backdrop">
          <section
            className="enrollment-dialog app-card text-ink dark:text-slate-100"
            role="dialog"
            aria-modal="true"
            aria-labelledby="enrollment-dialog-title"
          >
            <header className="enrollment-dialog-header">
              <div>
                <p className="text-xs font-medium text-steel dark:text-slate-400">Cadastro facial</p>
                <h2 id="enrollment-dialog-title" className="mt-0.5 text-lg font-semibold">{enrolling.name}</h2>
                <p className="text-xs text-steel dark:text-slate-400">
                  {enrolling.registration} · coleta contínua em poucos segundos
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`status-pill ${enrollmentSession && autoCaptureEnabled ? 'status-pill-online' : 'status-pill-neutral'}`}>
                  <span className={`status-dot ${enrollmentSession && autoCaptureEnabled ? 'status-dot-pulse' : ''}`} />
                  {enrollmentSession ? (autoCaptureEnabled ? 'Automático' : 'Pausado') : 'Aguardando API'}
                </span>
                <button
                  type="button"
                  onClick={() => setAutoCaptureEnabled((current) => !current)}
                  disabled={!enrollmentSession}
                  className="icon-button"
                  title={autoCaptureEnabled ? 'Pausar captura' : 'Retomar captura'}
                >
                  {autoCaptureEnabled ? <Pause size={17} /> : <Play size={17} />}
                </button>
                <button
                  ref={enrollmentCloseButtonRef}
                  type="button"
                  onClick={() => closeEnrollment()}
                  className="icon-button"
                  title="Fechar"
                  aria-label="Fechar cadastro facial"
                >
                  <X size={18} />
                </button>
              </div>
            </header>

            <div className="enrollment-dialog-body">
              <div className="enrollment-camera-column">
                {enrollmentSession ? (
                  <CameraCapture
                    ref={cameraRef}
                    className="enrollment-camera"
                    onReadyChange={setEnrollmentCameraReady}
                    onFacePresenceChange={setEnrollmentFacePresent}
                    faceOverlay={{
                      label: enrollmentComplete
                        ? 'Amostras consistentes'
                        : enrollmentFeedback || 'Olhe naturalmente para a câmera',
                      detail: `${acceptedSamples}/${enrollmentStepCount}`,
                      tone: captureRejected
                        ? 'warning'
                        : enrollmentComplete
                          ? 'success'
                          : 'tracking',
                    }}
                  />
                ) : (
                  <div className="enrollment-camera grid place-items-center bg-slate-950 px-8 text-center text-white">
                    <div className="grid max-w-sm justify-items-center gap-3">
                      {enrollSaving
                        ? <LoaderCircle size={32} className="animate-spin" />
                        : <AlertCircle size={32} className="text-amber-300" />}
                      <strong>{enrollSaving ? 'Verificando o backend facial' : 'Câmera não iniciada'}</strong>
                      <span className="text-sm text-slate-300">
                        A câmera só será aberta depois que a API confirmar que o modelo facial está pronto.
                      </span>
                    </div>
                  </div>
                )}
                <div className="enrollment-camera-caption">
                  <div className="flex items-center gap-2">
                    <span
                      className={`enrollment-presence-dot ${
                        enrollmentCameraReady && enrollmentFacePresent ? 'is-ready' : ''
                      }`}
                    />
                    <strong>
                      {!enrollmentSession
                        ? enrollSaving ? 'Verificando backend' : 'Backend facial indisponível'
                        : !enrollmentCameraReady
                          ? 'Iniciando câmera'
                          : enrollmentFacePresent
                            ? enrollSaving
                              ? 'Capturando'
                              : 'Rosto detectado'
                            : 'Entre no enquadramento'}
                    </strong>
                  </div>
                  <span>
                    {enrollmentSession
                      ? 'Amostras ruins são ignoradas sem apagar o progresso.'
                      : 'Nenhuma imagem foi capturada ou enviada.'}
                  </span>
                </div>
              </div>

              <aside className="enrollment-side-panel">
                <div>
                  <div className="mb-2 flex items-center justify-between gap-3 text-xs font-medium text-steel dark:text-slate-400">
                    <span>Progresso do cadastro</span>
                    <span>{acceptedSamples} de {enrollmentStepCount}</span>
                  </div>
                  <div className="enrollment-progress-track">
                    <span style={{ width: `${Math.max(enrollmentProgress, acceptedSamples ? 20 : 4)}%` }} />
                  </div>
                </div>

                <div
                  className={`enrollment-instruction ${
                    captureRejected ? 'is-warning' : enrollmentComplete ? 'is-success' : ''
                  }`}
                  aria-live="polite"
                >
                  <div className="enrollment-instruction-icon">
                    {enrollSaving
                      ? <LoaderCircle size={20} className="animate-spin" />
                      : captureRejected
                        ? <AlertCircle size={20} />
                        : enrollmentComplete
                          ? <Check size={20} />
                          : <Camera size={20} />}
                  </div>
                  <div>
                    <span>
                      {enrollmentComplete
                        ? 'Finalizando'
                        : acceptedSamples
                          ? `${acceptedSamples} amostras preservadas`
                          : 'Preparando'}
                    </span>
                    <strong>{enrollmentFeedback}</strong>
                  </div>
                </div>

                {sampleResult && (
                  <dl className="enrollment-diagnostics" aria-label="Diagnóstico da última leitura">
                    <div>
                      <dt>Qualidade</dt>
                      <dd>{Math.round((sampleResult.quality_score || 0) * 100)}%</dd>
                    </div>
                    <div>
                      <dt>Rosto no quadro</dt>
                      <dd>{((sampleResult.face_area_ratio || 0) * 100).toFixed(1)}%</dd>
                    </div>
                    <div>
                      <dt>Luz</dt>
                      <dd>{Math.round(sampleResult.luminance_mean || 0)}</dd>
                    </div>
                    <div>
                      <dt>Processamento</dt>
                      <dd>{Math.round(sampleResult.processing_ms || 0)} ms</dd>
                    </div>
                  </dl>
                )}

                <div className="enrollment-steps" aria-label="Amostras faciais preservadas">
                  {Array.from({ length: enrollmentStepCount }).map((_, index) => {
                    const preview = capturePreviews[index];
                    const active = index === acceptedSamples && !enrollmentComplete;
                    return (
                      <div
                        key={index}
                        className={`enrollment-step ${preview ? 'is-complete' : ''} ${active ? 'is-active' : ''}`}
                      >
                        {preview ? (
                          <img src={preview} alt="" />
                        ) : (
                          <span>{index + 1}</span>
                        )}
                        <div>
                          <strong>Amostra {index + 1}</strong>
                          <small>{preview ? 'Preservada' : active ? 'Coletando' : 'A seguir'}</small>
                        </div>
                        {preview && <CheckCircle2 size={17} />}
                      </div>
                    );
                  })}
                </div>

                <div className="mt-auto grid gap-2">
                  {!autoCaptureEnabled && !enrollmentComplete && (
                    <button
                      type="button"
                      onClick={() => void captureFace()}
                      disabled={enrollSaving || !enrollmentSession || !enrollmentFacePresent}
                      className="btn btn-primary w-full"
                    >
                      <Camera size={18} />
                      Capturar agora
                    </button>
                  )}
                  {enrollmentComplete && captureRejected && (
                    <button
                      type="button"
                      onClick={() => void submitEnrollment()}
                      disabled={enrollSaving}
                      className="btn btn-primary w-full"
                    >
                      <CheckCircle2 size={18} />
                      Tentar finalizar novamente
                    </button>
                  )}
                  <p className="text-xs leading-5 text-steel dark:text-slate-400">
                    O sistema seleciona automaticamente nitidez e variação. Nenhuma sequência rígida de poses é exigida.
                  </p>
                </div>
              </aside>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
