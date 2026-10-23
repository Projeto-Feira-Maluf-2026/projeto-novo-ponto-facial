import {
  Activity,
  Building2,
  Camera,
  ChevronRight,
  MapPin,
  Plus,
  RadioTower,
  UsersRound,
} from 'lucide-react';
import {
  FormEvent,
  KeyboardEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { useMovingTabIndicator } from '../animations/useMovingTabIndicator';
import { useAuth } from '../auth/AuthContext';
import { userCan } from '../auth/permissions';
import { DataTable } from '../components/DataTable';
import { apiClient } from '../services/api';
import { describeApiError } from '../services/apiErrors';
import type { DashboardMetrics, Device, Worksite } from '../types/domain';
import { readAttendancePulse, subscribeAttendancePulse } from '../utils/attendancePulse';

const WorksiteWorld3D = lazy(() => import('../components/WorksiteWorld3D')
  .then((module) => ({ default: module.WorksiteWorld3D })));

const initialForm = {
  name: '',
  code: '',
  address: '',
  manager_name: '',
};

function VisibleDigitalTwin({ worksite, activityPulse }: { worksite: Worksite; activityPulse: number }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    if (!('IntersectionObserver' in window)) {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '180px', threshold: 0.01 });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={rootRef} className="digital-twin-stage">
      {visible ? (
        <Suspense fallback={<div className="digital-twin-loading"><span /> Carregando gêmeo digital</div>}>
          <WorksiteWorld3D worksite={worksite} activityPulse={activityPulse} />
        </Suspense>
      ) : <div className="digital-twin-loading"><span /> Preparando visualização</div>}
    </div>
  );
}

export function WorksitesPage() {
  const tabsRef = useRef<HTMLDivElement>(null);
  const [worksites, setWorksites] = useState<Worksite[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  // RH reads worksites but not devices; show "—" instead of a misleading zero.
  const [devicesVisible, setDevicesVisible] = useState(false);
  const { user } = useAuth();
  const canCreateWorksite = userCan(user, 'worksites:write');
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [selectedWorksiteId, setSelectedWorksiteId] = useState('');
  const [attendancePulse, setAttendancePulse] = useState(0);

  const selectedWorksite = worksites.find((item) => item.id === selectedWorksiteId) ?? worksites[0] ?? null;
  useMovingTabIndicator(tabsRef, selectedWorksite?.id ?? null);
  const selectedDevices = selectedWorksite
    ? devices.filter((device) => device.worksite_id === selectedWorksite.id)
    : [];
  const selectedMovement = selectedWorksite
    ? metrics?.by_worksite.find((item) => item.name === selectedWorksite.name)?.records ?? 0
    : 0;

  const loadWorksites = useCallback(async () => {
    setLoading(true);
    try {
      const [worksitePage, devicePage, dashboard] = await Promise.all([
        apiClient.worksites(),
        apiClient.devices().catch(() => null),
        apiClient.dashboard().catch(() => null),
      ]);
      setWorksites(worksitePage.items);
      setDevices(devicePage?.items ?? []);
      setDevicesVisible(devicePage !== null);
      setMetrics(dashboard);
      setMessage('');
      setSelectedWorksiteId((current) => (
        worksitePage.items.some((item) => item.id === current)
          ? current
          : worksitePage.items[0]?.id ?? ''
      ));
    } catch (error) {
      setMessage(describeApiError(error, 'listar as obras'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadWorksites(); }, [loadWorksites]);

  useEffect(() => {
    let active = true;
    const refreshMetrics = async () => {
      if (document.hidden) return;
      const dashboard = await apiClient.dashboard().catch(() => null);
      if (active && dashboard) setMetrics(dashboard);
    };
    const timer = window.setInterval(() => void refreshMetrics(), 20_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const applyPulse = (pulse: ReturnType<typeof readAttendancePulse>) => {
      if (pulse?.worksiteId === selectedWorksiteId) setAttendancePulse(pulse.at);
    };
    applyPulse(readAttendancePulse());
    return subscribeAttendancePulse(applyPulse);
  }, [selectedWorksiteId]);

  const setField = (field: keyof typeof initialForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      await apiClient.createWorksite({
        name: form.name,
        code: form.code,
        address: form.address,
        manager_name: form.manager_name || null,
        active: true,
      });
      setForm(initialForm);
      setShowForm(false);
      setMessage('Obra cadastrada.');
      await loadWorksites();
    } catch (error) {
      setMessage(describeApiError(error, 'cadastrar a obra'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="app-view-transition space-y-5 premium-worksites">
      <section className="page-actions">
        <div className="page-actions-context">
          <span><RadioTower size={16} /> Visão das obras</span>
          <p>Quantas obras existem, quantas câmeras cada uma tem e o movimento de hoje.</p>
        </div>
        {canCreateWorksite && <button onClick={() => setShowForm((value) => !value)} className="btn btn-primary">
          <Plus size={18} />
          {showForm ? 'Fechar cadastro' : 'Nova obra'}
        </button>}
      </section>

      {message && <div className="feedback-banner app-view-transition" role="status">{message}</div>}

      {showForm && canCreateWorksite && (
        <form onSubmit={onSubmit} className="form-panel app-view-transition md:grid-cols-2 xl:grid-cols-4">
          <div className="form-panel-heading md:col-span-2 xl:col-span-4">
            <span>Novo local de operação</span>
            <h2>Cadastrar obra</h2>
          </div>
          <label className="field-label"><span>Nome</span><input value={form.name} onChange={(event) => setField('name', event.target.value)} required minLength={2} maxLength={160} className="input-field" /></label>
          <label className="field-label"><span>Código</span><input value={form.code} onChange={(event) => setField('code', event.target.value.toUpperCase())} required minLength={2} maxLength={40} className="input-field" /></label>
          <label className="field-label md:col-span-2"><span>Endereço</span><input value={form.address} onChange={(event) => setField('address', event.target.value)} required minLength={5} maxLength={255} className="input-field" /></label>
          <label className="field-label"><span>Responsável</span><input value={form.manager_name} onChange={(event) => setField('manager_name', event.target.value)} maxLength={160} className="input-field" /></label>
          <div className="flex flex-col items-stretch gap-2 md:col-span-2 sm:flex-row sm:items-end xl:col-span-4">
            <button disabled={saving} className="btn btn-primary"><Plus size={18} /> {saving ? 'Salvando' : 'Salvar obra'}</button>
          </div>
        </form>
      )}

      <dl className="worksite-statline" aria-label="Resumo das obras">
        <div><dt><Building2 size={17} /> Obras cadastradas</dt><dd>{worksites.length}</dd></div>
        <div><dt><Camera size={17} /> Câmeras e terminais</dt><dd>{devicesVisible ? devices.length : '—'}</dd></div>
        <div><dt><Activity size={17} /> Pontos hoje</dt><dd>{metrics?.records_today ?? 0}</dd></div>
      </dl>

      <section className="worksite-command" aria-labelledby="worksite-command-title">
        <header className="worksite-command-header">
          <div>
            <span className="section-eyebrow"><Building2 size={14} /> Visualização 3D</span>
            <h2 id="worksite-command-title">Cada obra em 3D</h2>
            <p>Gire a maquete e veja, ao lado, os dados de cada obra.</p>
          </div>
        </header>

        {selectedWorksite ? (
          <div className="worksite-command-grid">
            <aside className="worksite-portfolio" aria-label="Escolher obra">
              <div className="worksite-selector-heading"><span>Suas obras</span><strong>{String(worksites.length).padStart(2, '0')}</strong></div>
              <div ref={tabsRef} className="worksite-selector-list" role="tablist" aria-orientation="vertical">
                <span className="worksite-tab-indicator" data-tab-indicator aria-hidden="true" />
                {worksites.map((worksite, index) => {
                  const selected = worksite.id === selectedWorksite.id;
                  const deviceCount = devices.filter((device) => device.worksite_id === worksite.id).length;
                  return (
                    <button
                      key={worksite.id}
                      id={`worksite-tab-${worksite.id}`}
                      type="button"
                      role="tab"
                      tabIndex={selected ? 0 : -1}
                      aria-selected={selected}
                      aria-controls="worksite-digital-panel"
                      className="worksite-selector-item"
                      data-active={selected}
                      onClick={() => setSelectedWorksiteId(worksite.id)}
                      onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
                        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                        event.preventDefault();
                        const nextIndex = event.key === 'Home'
                          ? 0
                          : event.key === 'End'
                            ? worksites.length - 1
                            : (index + (event.key === 'ArrowDown' ? 1 : -1) + worksites.length) % worksites.length;
                        const next = worksites[nextIndex];
                        if (!next) return;
                        setSelectedWorksiteId(next.id);
                        document.getElementById(`worksite-tab-${next.id}`)?.focus();
                      }}
                    >
                      <span className="worksite-selector-index">{String(index + 1).padStart(2, '0')}</span>
                      <span className="worksite-selector-copy"><strong>{worksite.name}</strong><small>{worksite.code} · {deviceCount} {deviceCount === 1 ? 'dispositivo' : 'dispositivos'}</small></span>
                      <span className="worksite-selector-state" data-online={worksite.active} aria-label={worksite.active ? 'Obra ativa' : 'Obra inativa'} />
                      <ChevronRight size={16} aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
            </aside>

            <div
              key={selectedWorksite.id}
              id="worksite-digital-panel"
              className="worksite-digital-panel worksite-panel-transition"
              role="tabpanel"
              aria-labelledby={`worksite-tab-${selectedWorksite.id}`}
            >
              <VisibleDigitalTwin
                key={selectedWorksite.id}
                worksite={selectedWorksite}
                activityPulse={selectedMovement + attendancePulse}
              />
              <div className="worksite-intelligence">
                <div className="worksite-intelligence-heading">
                  <div><span>{selectedWorksite.code}</span><h3>{selectedWorksite.name}</h3><p><MapPin size={14} /> {selectedWorksite.address}</p></div>
                  <span className={`status-pill ${selectedWorksite.active ? 'status-pill-online' : 'status-pill-neutral'}`}><span className="status-dot" /> {selectedWorksite.active ? 'Operacional' : 'Inativa'}</span>
                </div>
                <dl className="worksite-signal-grid">
                  <div><dt><Activity size={16} /> Pontos hoje</dt><dd>{selectedMovement}</dd><small>Batidos nesta obra</small></div>
                  <div><dt><Camera size={16} /> Câmeras e terminais</dt><dd>{devicesVisible ? selectedDevices.length : '—'}</dd><small>{devicesVisible ? `${selectedDevices.filter((device) => device.status === 'ACTIVE').length} ativos` : 'Sem acesso a dispositivos'}</small></div>
                  <div><dt><UsersRound size={16} /> Responsável</dt><dd className="is-text">{selectedWorksite.manager_name || 'Não informado'}</dd><small>Quem cuida da obra</small></div>
                  <div><dt><Building2 size={16} /> Código</dt><dd className="is-text">{selectedWorksite.code}</dd><small>Usado nos relatórios</small></div>
                </dl>
                <div className="worksite-readiness">
                  <span>O que falta no cadastro</span>
                  <div>
                    <i data-ready={Boolean(selectedWorksite.manager_name)} /> Responsável
                    <i data-ready={Boolean(selectedWorksite.address)} /> Endereço
                    <i data-ready={selectedDevices.length > 0} /> Dispositivo
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="worksite-ops-empty">
            <span><Building2 size={24} /></span>
            <div><strong>Nenhuma obra para visualizar</strong><p>{canCreateWorksite ? 'Cadastre a primeira obra para ativar o gêmeo digital e seus terminais.' : 'Nenhuma obra está liberada para o seu perfil. Peça acesso a um administrador.'}</p></div>
            {canCreateWorksite && <button type="button" className="btn btn-secondary" onClick={() => setShowForm(true)}><Plus size={17} /> Cadastrar obra</button>}
          </div>
        )}
      </section>

      <DataTable
        ariaLabel="Obras cadastradas"
        rows={worksites}
        loading={loading}
        emptyTitle="Nenhuma obra cadastrada"
        emptyDescription="Cadastre a primeira obra para configurar seus terminais."
        columns={[
          { key: 'code', header: 'Código', mobileHidden: true },
          { key: 'name', header: 'Obra', mobilePrimary: true },
          { key: 'address', header: 'Endereço', mobileHidden: true },
          { key: 'manager_name', header: 'Responsável' },
          {
            key: 'active',
            header: 'Acesso',
            render: (row) => (
              <span className={`status-pill ${row.active ? 'status-pill-online' : 'status-pill-neutral'}`}>
                <span className="status-dot" />
                {row.active ? 'Ativo' : 'Inativo'}
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}
