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
import { apiClient } from '../services/api';
import type {
  Employee,
  EnrollmentCapturePayload,
  EnrollmentPose,
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

const poseInstructions: Record<EnrollmentPose, string> = {
  FRONTAL: 'Olhe de frente para a câmera',
  TURN_LEFT: 'Vire um pouco o rosto para a esquerda',
  TURN_RIGHT: 'Vire um pouco o rosto para a direita',
  LOOK_UP: 'Levante levemente o queixo',
  FRONTAL_FINAL: 'Volte a olhar de frente',
};

const poseLabels: Record<EnrollmentPose, string> = {
  FRONTAL: 'Frente',
  TURN_LEFT: 'Esquerda',
  TURN_RIGHT: 'Direita',
  LOOK_UP: 'Para cima',
  FRONTAL_FINAL: 'Frente final',
};

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function enrollmentError(error: unknown, fallback: string) {
  const payload = error as {
    response?: { data?: { error?: { code?: string; message?: string; details?: { reasons?: string[] } } } };
  };
  const apiError = payload.response?.data?.error;
  if (!apiError) return fallback;
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
  const [captures, setCaptures] = useState<EnrollmentCapturePayload[]>([]);
  const [capturePreviews, setCapturePreviews] = useState<string[]>([]);
  const [enrollmentFeedback, setEnrollmentFeedback] = useState('');
  const [enrollSaving, setEnrollSaving] = useState(false);
  const [enrollmentCameraReady, setEnrollmentCameraReady] = useState(false);
  const [enrollmentFacePresent, setEnrollmentFacePresent] = useState(false);
  const [autoCaptureEnabled, setAutoCaptureEnabled] = useState(true);
  const [captureRejected, setCaptureRejected] = useState(false);

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
    captureInFlightRef.current = false;
    finalizeInFlightRef.current = false;
    autoCaptureNotBeforeRef.current = Date.now() + 1_000;
    setEnrolling(employee);
    setEnrollmentSession(null);
    setCaptures([]);
    setCapturePreviews([]);
    setEnrollmentFeedback('Preparando sessão biométrica...');
    setEnrollmentCameraReady(false);
    setEnrollmentFacePresent(false);
    setAutoCaptureEnabled(true);
    setCaptureRejected(false);
    setMessage('');
    setEnrollSaving(true);
    try {
      const started = await apiClient.startFaceEnrollment(employee.id);
      setEnrollmentSession(started);
      setEnrollmentFeedback('Entre no enquadramento e olhe de frente. A captura será automática.');
    } catch (error) {
      setEnrollmentFeedback(enrollmentError(error, 'Não foi possível iniciar a sessão de cadastro facial.'));
    } finally {
      setEnrollSaving(false);
    }
  };

  const closeEnrollment = useCallback((cancelSession = true) => {
    if (cancelSession && enrolling && enrollmentSession) {
      void apiClient.cancelFaceEnrollment(enrolling.id, enrollmentSession.session_id).catch(() => undefined);
    }
    captureInFlightRef.current = false;
    finalizeInFlightRef.current = false;
    setEnrolling(null);
    setEnrollmentSession(null);
    setCaptures([]);
    setCapturePreviews([]);
    setEnrollmentFeedback('');
    setEnrollmentCameraReady(false);
    setEnrollmentFacePresent(false);
    setCaptureRejected(false);
  }, [enrolling, enrollmentSession]);

  const captureFace = useCallback(async () => {
    if (!enrolling || !enrollmentSession || captureInFlightRef.current) {
      setEnrollmentFeedback('A sessão facial ainda não está pronta.');
      return;
    }
    const stepIndex = captures.length;
    const pose = enrollmentSession.required_poses[stepIndex];
    if (!pose) return;

    captureInFlightRef.current = true;
    setCaptureRejected(false);
    setEnrollSaving(true);
    setEnrollmentFeedback('Capturando automaticamente. Continue parado...');
    try {
      const frames: EnrollmentCapturePayload['frames'] = [];
      const frameDelay = Math.ceil(
        enrollmentSession.minimum_burst_span_ms
          / Math.max(1, enrollmentSession.minimum_frames_per_pose - 1),
      ) + 20;
      for (let index = 0; index < enrollmentSession.minimum_frames_per_pose; index += 1) {
        const image = cameraRef.current?.capture({ faceCrop: true });
        if (!image) throw new Error('camera_not_ready');
        frames.push({ image_base64: image, captured_at: new Date().toISOString() });
        if (index + 1 < enrollmentSession.minimum_frames_per_pose) await wait(frameDelay);
      }

      const capture: EnrollmentCapturePayload = { step_index: stepIndex, pose, frames };
      const result = await apiClient.validateFaceEnrollmentCapture(
        enrolling.id,
        enrollmentSession.session_id,
        capture,
      );
      if (result.accepted) {
        const nextPose = result.next_pose;
        setCaptures((current) => [...current, capture]);
        setCapturePreviews((current) => [...current, frames[0].image_base64]);
        autoCaptureNotBeforeRef.current = Date.now() + 1_650;
        setEnrollmentFeedback(
          nextPose
            ? `Etapa concluída. Agora: ${poseInstructions[nextPose]}.`
            : 'Todas as etapas concluídas. Finalizando o cadastro...',
        );
      } else {
        setCaptureRejected(true);
        autoCaptureNotBeforeRef.current = Date.now() + 1_900;
        setEnrollmentFeedback(friendlyCaptureFeedback(result.instruction, result.reasons));
      }
    } catch (error) {
      setCaptureRejected(true);
      autoCaptureNotBeforeRef.current = Date.now() + 2_200;
      setEnrollmentFeedback(enrollmentError(error, 'Captura rejeitada. Ajuste o rosto e tente novamente.'));
    } finally {
      captureInFlightRef.current = false;
      setEnrollSaving(false);
    }
  }, [captures.length, enrolling, enrollmentSession]);

  const submitEnrollment = useCallback(async () => {
    if (
      !enrolling
      || !enrollmentSession
      || captures.length !== enrollmentSession.required_poses.length
      || finalizeInFlightRef.current
    ) {
      setEnrollmentFeedback('Conclua todas as poses antes de finalizar.');
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
        captures,
      );
      setMessage(`Face cadastrada: ${result.templates_created} templates, qualidade ${Math.round(result.quality_average * 100)}%.`);
      closeEnrollment(false);
      apiClient.employees().then((page) => setEmployees(page.items)).catch(() => undefined);
    } catch (error) {
      setCaptureRejected(true);
      setEnrollmentFeedback(enrollmentError(error, 'A consistência final foi rejeitada. Repita o cadastro guiado.'));
    } finally {
      finalizeInFlightRef.current = false;
      setEnrollSaving(false);
    }
  }, [captures, closeEnrollment, enrolling, enrollmentSession]);

  useEffect(() => {
    if (
      !autoCaptureEnabled
      || !enrolling
      || !enrollmentSession
      || !enrollmentCameraReady
      || !enrollmentFacePresent
      || enrollSaving
      || captures.length >= enrollmentSession.required_poses.length
    ) {
      return undefined;
    }

    const delay = Math.max(700, autoCaptureNotBeforeRef.current - Date.now());
    const timer = window.setTimeout(() => {
      void captureFace();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [
    autoCaptureEnabled,
    captureFace,
    captures.length,
    enrollSaving,
    enrolling,
    enrollmentCameraReady,
    enrollmentFacePresent,
    enrollmentSession,
  ]);

  useEffect(() => {
    if (
      !enrollmentSession
      || captures.length !== enrollmentSession.required_poses.length
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
  }, [captureRejected, captures.length, enrollSaving, enrollmentSession, submitEnrollment]);

  const currentEnrollmentPose = enrollmentSession?.required_poses[captures.length] ?? null;
  const enrollmentStepCount = enrollmentSession?.required_poses.length ?? 5;
  const enrollmentComplete = Boolean(
    enrollmentSession && captures.length === enrollmentSession.required_poses.length,
  );
  const enrollmentProgress = Math.round((captures.length / enrollmentStepCount) * 100);

  return (
    <div className="app-view-transition space-y-5">
      <section className="flex justify-end">
        <button
          onClick={() => setShowForm((value) => !value)}
          className="btn btn-primary"
        >
          <UserPlus size={18} />
          Adicionar funcionário
        </button>
      </section>

      {message && (
        <div className="app-card app-view-transition p-3 text-sm font-semibold text-steel dark:text-slate-200">
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
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full bg-transparent text-sm outline-none"
            placeholder="Buscar por nome ou matrícula"
          />
        </label>
        <div className="segmented-control">
          {(['ALL', 'ACTIVE', 'ON_LEAVE', 'INACTIVE'] as const).map((item) => (
            <button
              key={item}
              onClick={() => setStatus(item)}
              className="segmented-button"
              data-active={status === item}
            >
              {item === 'ALL' ? 'Todos' : item}
            </button>
          ))}
        </div>
      </section>

      <DataTable
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
                {row.status}
              </span>
            ),
          },
          {
            key: 'face',
            header: 'Face',
            render: (row) => (
              <span className="inline-flex items-center gap-2 text-sm font-semibold">
                {row.consent_biometric_at && !row.biometric_reenrollment_required ? <CheckCircle2 size={16} className="text-emerald-700 dark:text-emerald-300" /> : <Camera size={16} className="text-steel" />}
                {row.biometric_reenrollment_required ? 'Recadastro' : row.consent_biometric_at ? 'Ativa' : 'Pendente'}
              </span>
            ),
          },
          {
            key: 'actions',
            header: '',
            render: (row) => (
              <div className="flex justify-end gap-2">
                <button onClick={() => openEnrollment(row)} className="icon-button h-8 w-8" title="Cadastrar face">
                  <Camera size={16} />
                </button>
                <button className="icon-button h-8 w-8" title="Editar">
                  <Edit3 size={16} />
                </button>
                <button className="icon-button h-8 w-8 text-red-700 dark:text-red-300" title="Inativar">
                  <Trash2 size={16} />
                </button>
              </div>
            ),
          },
        ]}
      />

      {enrolling && (
        <div className="modal-backdrop">
          <section className="enrollment-dialog app-card text-ink dark:text-slate-100">
            <header className="enrollment-dialog-header">
              <div>
                <p className="text-xs font-medium text-steel dark:text-slate-400">Cadastro facial</p>
                <h2 className="mt-0.5 text-lg font-semibold">{enrolling.name}</h2>
                <p className="text-xs text-steel dark:text-slate-400">
                  {enrolling.registration} · aproximadamente 15 segundos
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`status-pill ${autoCaptureEnabled ? 'status-pill-online' : 'status-pill-neutral'}`}>
                  <span className={`status-dot ${autoCaptureEnabled ? 'status-dot-pulse' : ''}`} />
                  {autoCaptureEnabled ? 'Automático' : 'Pausado'}
                </span>
                <button
                  type="button"
                  onClick={() => setAutoCaptureEnabled((current) => !current)}
                  className="icon-button"
                  title={autoCaptureEnabled ? 'Pausar captura' : 'Retomar captura'}
                >
                  {autoCaptureEnabled ? <Pause size={17} /> : <Play size={17} />}
                </button>
                <button onClick={() => closeEnrollment()} className="icon-button" title="Fechar">
                  <X size={18} />
                </button>
              </div>
            </header>

            <div className="enrollment-dialog-body">
              <div className="enrollment-camera-column">
                <CameraCapture
                  ref={cameraRef}
                  className="enrollment-camera"
                  onReadyChange={setEnrollmentCameraReady}
                  onFacePresenceChange={setEnrollmentFacePresent}
                  faceOverlay={{
                    label: currentEnrollmentPose
                      ? poseInstructions[currentEnrollmentPose]
                      : enrollmentComplete
                        ? 'Cadastro concluído'
                        : 'Preparando câmera',
                    detail: enrollmentSession
                      ? `${Math.min(captures.length + 1, enrollmentStepCount)}/${enrollmentStepCount}`
                      : undefined,
                    tone: captureRejected
                      ? 'warning'
                      : enrollmentComplete
                        ? 'success'
                        : 'tracking',
                  }}
                />
                <div className="enrollment-camera-caption">
                  <div className="flex items-center gap-2">
                    <span
                      className={`enrollment-presence-dot ${
                        enrollmentCameraReady && enrollmentFacePresent ? 'is-ready' : ''
                      }`}
                    />
                    <strong>
                      {!enrollmentCameraReady
                        ? 'Iniciando câmera'
                        : enrollmentFacePresent
                          ? enrollSaving
                            ? 'Capturando'
                            : 'Rosto detectado'
                          : 'Entre no enquadramento'}
                    </strong>
                  </div>
                  <span>O rosto é aproximado e ajustado automaticamente.</span>
                </div>
              </div>

              <aside className="enrollment-side-panel">
                <div>
                  <div className="mb-2 flex items-center justify-between gap-3 text-xs font-medium text-steel dark:text-slate-400">
                    <span>Progresso do cadastro</span>
                    <span>{captures.length} de {enrollmentStepCount}</span>
                  </div>
                  <div className="enrollment-progress-track">
                    <span style={{ width: `${Math.max(enrollmentProgress, captures.length ? 20 : 4)}%` }} />
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
                      {currentEnrollmentPose
                        ? `Etapa ${captures.length + 1} · ${poseLabels[currentEnrollmentPose]}`
                        : enrollmentComplete
                          ? 'Finalizando'
                          : 'Preparando'}
                    </span>
                    <strong>{enrollmentFeedback}</strong>
                  </div>
                </div>

                <div className="enrollment-steps" aria-label="Etapas do cadastro">
                  {(enrollmentSession?.required_poses ?? Object.keys(poseLabels) as EnrollmentPose[]).map((pose, index) => {
                    const preview = capturePreviews[index];
                    const active = index === captures.length && !enrollmentComplete;
                    return (
                      <div
                        key={pose}
                        className={`enrollment-step ${preview ? 'is-complete' : ''} ${active ? 'is-active' : ''}`}
                      >
                        {preview ? (
                          <img src={preview} alt="" />
                        ) : (
                          <span>{index + 1}</span>
                        )}
                        <div>
                          <strong>{poseLabels[pose]}</strong>
                          <small>{preview ? 'Concluída' : active ? 'Agora' : 'A seguir'}</small>
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
                    As imagens são validadas uma a uma. Se algo não estiver bom, o sistema tenta novamente na mesma etapa.
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
