import {
  ArrowRight,
  Building2,
  Camera,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Cpu,
  Database,
  Fingerprint,
  HardDrive,
  Mail,
  Play,
  Radio,
  RefreshCw,
  ScanFace,
  ShieldCheck,
  UserPlus,
  UsersRound,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { usePresentationMode } from '../presentation/PresentationContext';
import { apiClient } from '../services/api';
import type {
  AttendanceRecord,
  DashboardMetrics,
  Device,
  Employee,
  FaceCapabilitiesResponse,
  Worksite,
} from '../types/domain';
import { parseApiDate } from '../utils/dateTime';
import { readAttendancePulse, subscribeAttendancePulse } from '../utils/attendancePulse';

const punchLabels: Record<AttendanceRecord['punch_type'], string> = {
  ENTRY: 'Entrada',
  LUNCH_OUT: 'Saída para intervalo',
  LUNCH_IN: 'Retorno do intervalo',
  EXIT: 'Saída',
};

type LoadState = 'loading' | 'ready' | 'partial' | 'error';

export function PresentationPage() {
  const presentation = usePresentationMode();
  const baselineRecordsRef = useRef<number | null>(null);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [worksites, setWorksites] = useState<Worksite[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [history, setHistory] = useState<AttendanceRecord[]>([]);
  const [capabilities, setCapabilities] = useState<FaceCapabilitiesResponse | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [apiLatency, setApiLatency] = useState<number | null>(null);
  const [sessionRecords, setSessionRecords] = useState(0);
  const [sessionEmails, setSessionEmails] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);

  const load = useCallback(async () => {
    const startedAt = performance.now();
    const [nextMetrics, employeePage, worksitePage, devicePage, nextHistory, nextCapabilities] = await Promise.allSettled([
      apiClient.dashboard(),
      apiClient.employees(),
      apiClient.worksites(),
      apiClient.devices(),
      apiClient.attendanceHistory(),
      apiClient.faceCapabilities(),
    ]);
    setApiLatency(Math.round(performance.now() - startedAt));

    let successCount = 0;
    if (nextMetrics.status === 'fulfilled') {
      successCount += 1;
      setMetrics(nextMetrics.value);
      if (baselineRecordsRef.current === null) baselineRecordsRef.current = nextMetrics.value.records_today;
      setSessionRecords((current) => Math.max(current, nextMetrics.value.records_today - (baselineRecordsRef.current ?? nextMetrics.value.records_today)));
    }
    if (employeePage.status === 'fulfilled') { successCount += 1; setEmployees(employeePage.value.items); }
    if (worksitePage.status === 'fulfilled') { successCount += 1; setWorksites(worksitePage.value.items); }
    if (devicePage.status === 'fulfilled') { successCount += 1; setDevices(devicePage.value.items); }
    if (nextHistory.status === 'fulfilled') { successCount += 1; setHistory(nextHistory.value); }
    if (nextCapabilities.status === 'fulfilled') { successCount += 1; setCapabilities(nextCapabilities.value); }
    setLoadState(successCount === 6 ? 'ready' : successCount > 0 ? 'partial' : 'error');
    setLastRefresh(new Date());
  }, []);

  useEffect(() => {
    if (!presentation.active) presentation.start();
    void load();
    const timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 8_000);
    return () => window.clearInterval(timer);
  }, [load, presentation]);

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, []);

  useEffect(() => {
    const applyPulse = (pulse: ReturnType<typeof readAttendancePulse>) => {
      if (!pulse || !presentation.startedAt || pulse.at < presentation.startedAt) return;
      setSessionRecords((current) => current + pulse.count);
      setSessionEmails((current) => current + (pulse.emailCount || 0));
      void load();
    };
    applyPulse(readAttendancePulse());
    return subscribeAttendancePulse(applyPulse);
  }, [load, presentation.startedAt]);

  const activeEmployees = employees.filter((employee) => employee.status === 'ACTIVE');
  const enrolledEmployees = activeEmployees.filter((employee) => (
    Boolean(employee.consent_biometric_at) && !employee.biometric_reenrollment_required
  ));
  const activeDevices = devices.filter((device) => device.status === 'ACTIVE');
  const recentHistory = useMemo(() => (
    [...history]
      .sort((left, right) => parseApiDate(right.occurred_at).getTime() - parseApiDate(left.occurred_at).getTime())
      .slice(0, 5)
  ), [history]);
  const employeesById = useMemo(() => new Map(employees.map((employee) => [employee.id, employee])), [employees]);
  const worksitesById = useMemo(() => new Map(worksites.map((worksite) => [worksite.id, worksite])), [worksites]);
  const startedAtLabel = presentation.startedAt
    ? new Date(presentation.startedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : 'agora';

  return (
    <div className="presentation-console app-view-transition">
      <section className="presentation-intro">
        <div className="presentation-intro-copy">
          <span className="presentation-live-mark"><Radio size={14} /> Sessão iniciada às {startedAtLabel}</span>
          <h2>Do rosto ao registro, ao vivo.</h2>
          <p>Cadastre um participante, registre o ponto pela câmera e acompanhe a confirmação e o e-mail usando a operação real do sistema.</p>
          <div className="presentation-intro-actions">
            <Link to="/funcionarios?novo=apresentacao" className="btn btn-on-dark">
              <UserPlus size={17} /> Cadastrar participante
            </Link>
            <Link to="/terminal-facial" className="btn presentation-secondary-action">
              <Camera size={17} /> Abrir câmera
            </Link>
          </div>
        </div>
        <div className="presentation-session-number" aria-label={`${sessionRecords} registros nesta apresentação`}>
          <span>Registros nesta sessão</span>
          <strong>{sessionRecords}</strong>
          <small>Atualiza após cada confirmação real</small>
        </div>
      </section>

      <section className="presentation-flow" aria-labelledby="presentation-flow-title">
        <header>
          <div><span>Roteiro recomendado</span><h3 id="presentation-flow-title">Demonstração em quatro movimentos</h3></div>
          <span className={`presentation-data-state is-${loadState}`}>
            {loadState === 'ready' ? <CheckCircle2 size={15} /> : <CircleAlert size={15} />}
            {loadState === 'ready' ? 'Dados reais atualizados' : loadState === 'loading' ? 'Consultando sistema' : 'Dados parcialmente disponíveis'}
          </span>
        </header>
        <ol>
          <li><span>01</span><UserPlus size={20} /><div><strong>Cadastro</strong><small>Nome, e-mail e obra</small></div><Link to="/funcionarios?novo=apresentacao" aria-label="Abrir cadastro"><ArrowRight size={17} /></Link></li>
          <li><span>02</span><ScanFace size={20} /><div><strong>Face</strong><small>Coleta biométrica real</small></div><Link to="/funcionarios" aria-label="Abrir funcionários"><ArrowRight size={17} /></Link></li>
          <li><span>03</span><Fingerprint size={20} /><div><strong>Ponto</strong><small>Uma ou mais pessoas</small></div><Link to="/terminal-facial" aria-label="Abrir terminal"><ArrowRight size={17} /></Link></li>
          <li><span>04</span><Mail size={20} /><div><strong>Confirmação</strong><small>Registro e e-mail</small></div><Link to="/auditoria" aria-label="Abrir auditoria"><ArrowRight size={17} /></Link></li>
        </ol>
      </section>

      <section className="presentation-live-grid">
        <article className="presentation-live-metrics" aria-labelledby="live-title">
          <header><div><span>Operação agora</span><h3 id="live-title">Painel da demonstração</h3></div><button type="button" onClick={() => void load()} aria-label="Atualizar dados"><RefreshCw size={16} /></button></header>
          <dl>
            <div><UsersRound size={18} /><dt>Participantes ativos</dt><dd>{activeEmployees.length}</dd></div>
            <div><ScanFace size={18} /><dt>Faces cadastradas</dt><dd>{enrolledEmployees.length}</dd></div>
            <div><Building2 size={18} /><dt>Obras ativas</dt><dd>{worksites.filter((item) => item.active).length}</dd></div>
            <div><HardDrive size={18} /><dt>Dispositivos ativos</dt><dd>{activeDevices.length}</dd></div>
            <div><Clock3 size={18} /><dt>Registros hoje</dt><dd>{metrics?.records_today ?? '—'}</dd></div>
            <div><Mail size={18} /><dt>E-mails nesta sessão</dt><dd>{sessionEmails}</dd></div>
          </dl>
        </article>

        <article className="presentation-diagnostics" aria-labelledby="diagnostics-title">
          <header><span>Antes de apresentar</span><h3 id="diagnostics-title">Diagnóstico rápido</h3></header>
          <ul>
            <li data-ok={online}>{online ? <Wifi size={17} /> : <WifiOff size={17} />}<div><strong>Internet</strong><small>{online ? 'Navegador conectado' : 'Sem conexão; não inicie um cadastro'}</small></div></li>
            <li data-ok={capabilities?.provider_ready === true}><Cpu size={17} /><div><strong>IA facial</strong><small>{capabilities?.provider_ready ? `${capabilities.model_name || 'Modelo'} pronto` : 'Backend facial indisponível'}</small></div></li>
            <li data-ok={activeDevices.length > 0}><Camera size={17} /><div><strong>Dispositivos</strong><small>{activeDevices.length ? `${activeDevices.length} ativo(s) no sistema` : 'Nenhum dispositivo ativo'}</small></div></li>
            <li data-ok={Boolean(lastRefresh)}><Database size={17} /><div><strong>Dados</strong><small>{lastRefresh ? `Atualizados às ${lastRefresh.toLocaleTimeString('pt-BR')} em ${apiLatency ?? '—'} ms` : 'Aguardando resposta'}</small></div></li>
          </ul>
        </article>
      </section>

      <section className="presentation-evidence-grid">
        <article className="presentation-recent" aria-labelledby="recent-title">
          <header><div><span>Evidência operacional</span><h3 id="recent-title">Últimos registros</h3></div><Link to="/relatorios">Abrir relatórios <ArrowRight size={15} /></Link></header>
          {recentHistory.length ? (
            <ul>{recentHistory.map((record) => {
              const employee = employeesById.get(record.employee_id);
              const worksite = worksitesById.get(record.worksite_id);
              return (
                <li key={record.id}>
                  <span className="presentation-record-icon"><CheckCircle2 size={17} /></span>
                  <div><strong>{employee?.name || 'Funcionário cadastrado'}</strong><small>{worksite?.name || 'Obra'} · {punchLabels[record.punch_type]}</small></div>
                  <time dateTime={record.occurred_at}>{parseApiDate(record.occurred_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time>
                </li>
              );
            })}</ul>
          ) : <p className="presentation-empty">O primeiro ponto confirmado aparecerá aqui.</p>}
        </article>

        <article className="presentation-explainer" aria-labelledby="explainer-title">
          <header><span>Como funciona</span><h3 id="explainer-title">Processamento sem mistério</h3></header>
          <div className="presentation-pipeline" aria-label="Etapas técnicas do reconhecimento facial">
            <span><Camera size={18} /><b>Imagem</b></span><i /><span><ScanFace size={18} /><b>Detecção</b></span><i /><span><Cpu size={18} /><b>Comparação</b></span><i /><span><ShieldCheck size={18} /><b>Registro</b></span><i /><span><Mail size={18} /><b>E-mail</b></span>
          </div>
          <p>A câmera captura o quadro, cada rosto é separado, comparado com cadastros compatíveis e somente uma decisão aceita gera ponto e notificação.</p>
          <dl>
            <div><dt>Modelo</dt><dd>{capabilities?.model_name || 'Indisponível'}</dd></div>
            <div><dt>Detector</dt><dd>{capabilities?.detector_name || 'Indisponível'}</dd></div>
            <div><dt>Limite por leitura</dt><dd>Até 5 rostos</dd></div>
          </dl>
        </article>
      </section>

      <section className="presentation-safety-note">
        <ShieldCheck size={21} />
        <div><strong>Dados e recuperação</strong><p>O e-mail só é enviado depois que o backend aceita e salva o ponto. O terminal só arma uma nova leitura depois que o rosto sai do quadro, e as operações sensíveis ficam disponíveis para conferência na auditoria. Se a câmera falhar, o operador pode reiniciá-la sem recarregar o sistema inteiro.</p></div>
      </section>
    </div>
  );
}
