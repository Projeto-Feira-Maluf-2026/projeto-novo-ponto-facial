import {
  CalendarDays,
  Camera,
  CheckCircle2,
  Edit3,
  Eye,
  Fingerprint,
  IdCard,
  Mail,
  Search,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { CameraCaptureHandle } from '../components/CameraCapture';
import { DataTable } from '../components/DataTable';
import { FaceEnrollmentDialog } from '../components/FaceEnrollmentDialog';
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
  const detailCloseButtonRef = useRef<HTMLButtonElement>(null);
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
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [pendingDeactivation, setPendingDeactivation] = useState<Employee | null>(null);
  const [enrolling, setEnrolling] = useState<Employee | null>(null);
  const [enrollmentSession, setEnrollmentSession] = useState<EnrollmentSessionResponse | null>(null);
  const [enrollmentReady, setEnrollmentReady] = useState(false);
  const [sampleResult, setSampleResult] = useState<EnrollmentSampleResponse | null>(null);
  const [capturePreviews, setCapturePreviews] = useState<string[]>([]);
  const [enrollmentFeedback, setEnrollmentFeedback] = useState('');
  const [enrollSaving, setEnrollSaving] = useState(false);
  const [enrollmentCameraReady, setEnrollmentCameraReady] = useState(false);
  const [enrollmentFacePresent, setEnrollmentFacePresent] = useState(false);
  const [autoCaptureEnabled, setAutoCaptureEnabled] = useState(true);
  const [captureRejected, setCaptureRejected] = useState(false);
  const [detailEmployee, setDetailEmployee] = useState<Employee | null>(null);
  useModalMotion(enrollmentModalRef, enrolling?.id ?? null);

  useEffect(() => {
    if (!detailEmployee) return undefined;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDetailEmployee(null);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    window.requestAnimationFrame(() => detailCloseButtonRef.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [detailEmployee]);

  const loadEmployees = useCallback(async () => {
    setLoadingEmployees(true);
    try {
      const page = await apiClient.employees();
      setEmployees(page.items);
    } catch {
      setMessage('Entre novamente e verifique se a API está online.');
    } finally {
      setLoadingEmployees(false);
    }
  }, []);

  useEffect(() => {
    loadEmployees();
    apiClient
      .worksites()
      .then((page) => setWorksites(page.items))
      .catch(() => undefined);
  }, [loadEmployees]);

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

  const openCreateForm = () => {
    setEditingEmployee(null);
    setForm(initialForm);
    setShowForm(true);
    setMessage('');
  };

  const openEditForm = (employee: Employee) => {
    setEditingEmployee(employee);
    setForm({ ...initialForm, registration: employee.registration, name: employee.name, email: employee.email || '' });
    setShowForm(true);
    setMessage('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const closeEmployeeForm = () => {
    setEditingEmployee(null);
    setForm(initialForm);
    setShowForm(false);
  };

  const onSaveEmployee = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      if (editingEmployee) {
        await apiClient.updateEmployee(editingEmployee.id, { name: form.name, email: form.email || null });
      } else {
        await apiClient.createEmployee({
          registration: form.registration,
          name: form.name,
          email: form.email || null,
          document: form.document || null,
          phone: form.phone || null,
          worksite_ids: form.worksite_id ? [form.worksite_id] : [],
          status: 'ACTIVE',
        });
      }
      setForm(initialForm);
      setShowForm(false);
      setEditingEmployee(null);
      setMessage(editingEmployee ? 'Dados do funcionário atualizados.' : 'Funcionário cadastrado.');
      await loadEmployees();
    } catch {
      setMessage(editingEmployee ? 'Não foi possível atualizar o funcionário.' : 'Não foi possível cadastrar o funcionário.');
    } finally {
      setSaving(false);
    }
  };

  const deactivateEmployee = async () => {
    if (!pendingDeactivation) return;
    setSaving(true);
    setMessage('');
    try {
      await apiClient.updateEmployee(pendingDeactivation.id, { status: 'INACTIVE' });
      setMessage(`${pendingDeactivation.name} foi inativado.`);
      setPendingDeactivation(null);
      await loadEmployees();
    } catch {
      setMessage('Não foi possível inativar o funcionário.');
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
    setEnrollmentFeedback('Analisando nitidez, luz e posição do rosto...');
    try {
      const image = cameraRef.current?.capture({ faceCrop: true });
      if (!image) throw new Error('camera_not_ready');
      const result = await apiClient.collectFaceEnrollmentSample(
        enrolling.id,
        enrollmentSession.session_id,
        { image_base64: image, captured_at: new Date().toISOString() },
      );
      setSampleResult(result);
      setEnrollmentReady(result.ready);
      if (result.accepted) {
        setCapturePreviews([image]);
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
      setEnrollmentFeedback('Aguarde uma foto frontal com qualidade suficiente.');
      return;
    }
    finalizeInFlightRef.current = true;
    setEnrollSaving(true);
    setCaptureRejected(false);
    setEnrollmentFeedback('Protegendo o modelo facial...');
    setMessage('');
    try {
      const result = await apiClient.finalizeFaceEnrollment(
        enrolling.id,
        enrollmentSession.session_id,
      );
      setMessage(`Face cadastrada com sucesso. Qualidade da foto: ${Math.round(result.quality_average * 100)}%.`);
      closeEnrollment(false);
      apiClient.employees().then((page) => setEmployees(page.items)).catch(() => undefined);
    } catch (error) {
      setCaptureRejected(true);
      setEnrollmentFeedback(enrollmentError(error, 'A foto não passou pela validação final. Posicione-se de frente e tente novamente.'));
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

  const enrollmentComplete = enrollmentReady;

  return (
    <div className="app-view-transition space-y-5">
      <section className="page-actions">
        <button
          onClick={() => showForm ? closeEmployeeForm() : openCreateForm()}
          className="btn btn-primary"
        >
          <UserPlus size={18} />
          {showForm ? 'Fechar formulário' : 'Adicionar funcionário'}
        </button>
      </section>

      {message && (
        <div className="feedback-banner app-view-transition" role="status">
          {message}
        </div>
      )}

      {pendingDeactivation && (
        <section className="confirmation-strip" role="alertdialog" aria-labelledby="deactivate-title">
          <div><strong id="deactivate-title">Inativar {pendingDeactivation.name}?</strong><span>O funcionário deixará de registrar ponto, mas o histórico será preservado.</span></div>
          <div><button type="button" className="btn btn-secondary" onClick={() => setPendingDeactivation(null)}>Cancelar</button><button type="button" className="btn btn-danger" disabled={saving} onClick={() => void deactivateEmployee()}>Confirmar inativação</button></div>
        </section>
      )}

      {showForm && (
        <form onSubmit={onSaveEmployee} className="form-panel app-view-transition md:grid-cols-2 xl:grid-cols-3">
          <div className="form-panel-heading md:col-span-2 xl:col-span-3"><span>{editingEmployee ? 'Edição de cadastro' : 'Novo cadastro'}</span><h2>{editingEmployee ? editingEmployee.name : 'Adicionar funcionário'}</h2></div>
          <label className="field-label">
            <span>Matrícula</span>
            <input value={form.registration} onChange={(event) => setField('registration', event.target.value)} required disabled={Boolean(editingEmployee)} className="input-field" />
          </label>
          <label className="field-label">
            <span>Nome</span>
            <input value={form.name} onChange={(event) => setField('name', event.target.value)} required className="input-field" />
          </label>
          <label className="field-label">
            <span>Email</span>
            <input type="email" value={form.email} onChange={(event) => setField('email', event.target.value)} className="input-field" />
          </label>
          {!editingEmployee && <label className="field-label">
            <span>Documento</span>
            <input value={form.document} onChange={(event) => setField('document', event.target.value)} className="input-field" />
          </label>}
          {!editingEmployee && <label className="field-label">
            <span>Telefone</span>
            <input value={form.phone} onChange={(event) => setField('phone', event.target.value)} className="input-field" />
          </label>}
          {!editingEmployee && <label className="field-label">
            <span>Obra</span>
            <select value={form.worksite_id} onChange={(event) => setField('worksite_id', event.target.value)} className="input-field">
              <option value="">Sem obra</option>
              {worksites.map((worksite) => (
                <option key={worksite.id} value={worksite.id}>
                  {worksite.name}
                </option>
              ))}
            </select>
          </label>}
          <div className="flex items-end gap-2 md:col-span-2 xl:col-span-3">
            <button disabled={saving} className="btn btn-primary">
              {editingEmployee ? <Edit3 size={18} /> : <UserPlus size={18} />}
              {saving ? 'Salvando' : editingEmployee ? 'Salvar alterações' : 'Salvar funcionário'}
            </button>
            <button type="button" onClick={closeEmployeeForm} className="btn btn-secondary">Cancelar</button>
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
        loading={loadingEmployees}
        emptyTitle={query || status !== 'ALL' ? 'Nenhum funcionário neste filtro' : 'Nenhum funcionário cadastrado'}
        emptyDescription={query || status !== 'ALL' ? 'Altere a busca ou o status para ampliar os resultados.' : 'Adicione o primeiro funcionário para iniciar a operação.'}
        columns={[
          { key: 'registration', header: 'Matrícula', mobileHidden: true },
          {
            key: 'name',
            header: 'Funcionário',
            mobilePrimary: true,
            render: (row) => (
              <button type="button" className="employee-identity" onClick={() => setDetailEmployee(row)}>
                <span className="employee-avatar">
                  {row.photo_url
                    ? <img src={row.photo_url} alt="" />
                    : row.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}
                </span>
                <span><strong>{row.name}</strong><small>{row.registration}</small></span>
              </button>
            ),
          },
          { key: 'email', header: 'Email', mobileHidden: true },
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
            mobileHidden: true,
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
                <button type="button" onClick={() => setDetailEmployee(row)} className="icon-button" title="Ver detalhes" aria-label={`Ver detalhes de ${row.name}`}>
                  <Eye size={16} />
                </button>
                <button type="button" onClick={() => openEnrollment(row)} className="icon-button" title="Cadastrar face" aria-label={`Cadastrar face de ${row.name}`}>
                  <Camera size={16} />
                </button>
                <button type="button" onClick={() => openEditForm(row)} className="icon-button" title="Editar" aria-label={`Editar ${row.name}`}>
                  <Edit3 size={16} />
                </button>
                <button type="button" onClick={() => setPendingDeactivation(row)} disabled={row.status === 'INACTIVE'} className="icon-button text-red-700 dark:text-red-300" title="Inativar" aria-label={`Inativar ${row.name}`}>
                  <Trash2 size={16} />
                </button>
              </div>
            ),
          },
        ]}
      />

      {detailEmployee && (
        <div className="employee-drawer-layer">
          <button type="button" className="employee-drawer-scrim" aria-label="Fechar detalhes" onClick={() => setDetailEmployee(null)} />
          <aside className="employee-drawer" role="dialog" aria-modal="true" aria-labelledby="employee-detail-title">
            <header className="employee-drawer-header">
              <span>Detalhes do funcionário</span>
              <button ref={detailCloseButtonRef} type="button" className="icon-button" onClick={() => setDetailEmployee(null)} aria-label="Fechar detalhes">
                <X size={18} />
              </button>
            </header>
            <div className="employee-profile-hero">
              <span className="employee-profile-avatar">
                {detailEmployee.photo_url
                  ? <img src={detailEmployee.photo_url} alt="" />
                  : detailEmployee.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}
              </span>
              <div>
                <span className={`status-pill ${detailEmployee.status === 'ACTIVE' ? 'status-pill-online' : detailEmployee.status === 'ON_LEAVE' ? 'status-pill-warn' : 'status-pill-neutral'}`}>
                  <span className="status-dot" /> {employeeStatusLabels[detailEmployee.status]}
                </span>
                <h2 id="employee-detail-title">{detailEmployee.name}</h2>
                <p>Matrícula {detailEmployee.registration}</p>
              </div>
            </div>
            <dl className="employee-detail-list">
              <div><dt><IdCard size={16} /> Matrícula</dt><dd>{detailEmployee.registration}</dd></div>
              <div><dt><Mail size={16} /> E-mail</dt><dd>{detailEmployee.email || 'Não informado'}</dd></div>
              <div><dt><Fingerprint size={16} /> Biometria facial</dt><dd>{detailEmployee.biometric_reenrollment_required ? 'Recadastro necessário' : detailEmployee.consent_biometric_at ? 'Cadastro ativo' : 'Cadastro pendente'}</dd></div>
              <div><dt><CalendarDays size={16} /> Atualizado em</dt><dd>{new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(new Date(detailEmployee.updated_at))}</dd></div>
            </dl>
            {detailEmployee.biometric_reenrollment_reason && (
              <div className="employee-biometric-note" role="status">{detailEmployee.biometric_reenrollment_reason}</div>
            )}
            <div className="employee-drawer-actions">
              <button type="button" className="btn btn-primary" onClick={() => { setDetailEmployee(null); void openEnrollment(detailEmployee); }}>
                <Camera size={17} /> {detailEmployee.consent_biometric_at ? 'Atualizar face' : 'Cadastrar face'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => { setDetailEmployee(null); openEditForm(detailEmployee); }}>
                <Edit3 size={17} /> Editar cadastro
              </button>
            </div>
            <p className="employee-data-note">Horas, cargo e obra atual não aparecem aqui porque esses campos ainda não são retornados pelo cadastro da API.</p>
          </aside>
        </div>
      )}

      {enrolling && (
        <FaceEnrollmentDialog
          employee={enrolling}
          dialogRef={enrollmentModalRef}
          closeButtonRef={enrollmentCloseButtonRef}
          cameraRef={cameraRef}
          session={enrollmentSession}
          complete={enrollmentComplete}
          sampleResult={sampleResult}
          capturePreview={capturePreviews[capturePreviews.length - 1]}
          feedback={enrollmentFeedback}
          saving={enrollSaving}
          cameraReady={enrollmentCameraReady}
          facePresent={enrollmentFacePresent}
          autoCaptureEnabled={autoCaptureEnabled}
          captureRejected={captureRejected}
          onClose={() => closeEnrollment()}
          onToggleAutoCapture={() => setAutoCaptureEnabled((current) => !current)}
          onCapture={() => void captureFace()}
          onFinalize={() => void submitEnrollment()}
          onCameraReadyChange={setEnrollmentCameraReady}
          onFacePresenceChange={setEnrollmentFacePresent}
        />
      )}
    </div>
  );
}
