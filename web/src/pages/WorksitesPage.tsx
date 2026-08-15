import {
  Activity,
  Building2,
  Camera,
  ChevronRight,
  MapPin,
  Plus,
  RadioTower,
  ShieldCheck,
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

import { DataTable } from '../components/DataTable';
import { apiClient } from '../services/api';
import type { DashboardMetrics, Device, Worksite } from '../types/domain';

const WorksiteWorld3D = lazy(() => import('../components/WorksiteWorld3D')
  .then((module) => ({ default: module.WorksiteWorld3D })));

const initialForm = {
  name: '',
  code: '',
  address: '',
  manager_name: '',
  latitude: '',
  longitude: '',
  geofence_radius_meters: '120',
};

function VisibleDigitalTwin({ worksite }: { worksite: Worksite }) {
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
          <WorksiteWorld3D worksite={worksite} />
        </Suspense>
      ) : <div className="digital-twin-loading"><span /> Preparando visualização</div>}
    </div>
  );
}

export function WorksitesPage() {
  const [worksites, setWorksites] = useState<Worksite[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [selectedWorksiteId, setSelectedWorksiteId] = useState('');

  const selectedWorksite = worksites.find((item) => item.id === selectedWorksiteId) ?? worksites[0] ?? null;
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
      setMetrics(dashboard);
      setMessage((current) => current === 'Entre novamente e verifique se a API está online.' ? '' : current);
      setSelectedWorksiteId((current) => (
        worksitePage.items.some((item) => item.id === current)
          ? current
          : worksitePage.items[0]?.id ?? ''
      ));
    } catch {
      setMessage('Entre novamente e verifique se a API está online.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadWorksites(); }, [loadWorksites]);

  const setField = (field: keyof typeof initialForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const useCurrentLocation = () => {
    navigator.geolocation?.getCurrentPosition(
      (position) => {
        setForm((current) => ({
          ...current,
          latitude: String(position.coords.latitude),
          longitude: String(position.coords.longitude),
        }));
      },
      () => setMessage('Não foi possível obter a localização atual.'),
      { enableHighAccuracy: true, timeout: 8000 },
    );
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
        latitude: form.latitude ? Number(form.latitude) : null,
        longitude: form.longitude ? Number(form.longitude) : null,
        geofence_radius_meters: Number(form.geofence_radius_meters || 120),
        active: true,
      });
      setForm(initialForm);
      setShowForm(false);
      setMessage('Obra cadastrada.');
      await loadWorksites();
    } catch {
      setMessage('Não foi possível cadastrar a obra.');
    } finally {
      setSaving(false);
    }
  };

  const averageRadius = Math.round(
    worksites.reduce((acc, item) => acc + item.geofence_radius_meters, 0) / Math.max(worksites.length, 1),
  );

  return (
    <div className="app-view-transition space-y-5 premium-worksites">
      <section className="page-actions">
        <div className="page-actions-context">
          <span><RadioTower size={16} /> Cobertura operacional</span>
          <p>Cadastros, atividade e infraestrutura de cada frente de trabalho.</p>
        </div>
        <button onClick={() => setShowForm((value) => !value)} className="btn btn-primary">
          <Plus size={18} />
          {showForm ? 'Fechar cadastro' : 'Nova obra'}
        </button>
      </section>

      {message && <div className="feedback-banner app-view-transition" role="status">{message}</div>}

      {showForm && (
        <form onSubmit={onSubmit} className="form-panel app-view-transition md:grid-cols-2 xl:grid-cols-4">
          <div className="form-panel-heading md:col-span-2 xl:col-span-4">
            <span>Novo local de operação</span>
            <h2>Cadastrar obra</h2>
          </div>
          <label className="field-label"><span>Nome</span><input value={form.name} onChange={(event) => setField('name', event.target.value)} required className="input-field" /></label>
          <label className="field-label"><span>Código</span><input value={form.code} onChange={(event) => setField('code', event.target.value.toUpperCase())} required className="input-field" /></label>
          <label className="field-label md:col-span-2"><span>Endereço</span><input value={form.address} onChange={(event) => setField('address', event.target.value)} required className="input-field" /></label>
          <label className="field-label"><span>Responsável</span><input value={form.manager_name} onChange={(event) => setField('manager_name', event.target.value)} className="input-field" /></label>
          <label className="field-label"><span>Latitude</span><input value={form.latitude} onChange={(event) => setField('latitude', event.target.value)} inputMode="decimal" className="input-field" /></label>
          <label className="field-label"><span>Longitude</span><input value={form.longitude} onChange={(event) => setField('longitude', event.target.value)} inputMode="decimal" className="input-field" /></label>
          <label className="field-label"><span>Raio da geofence</span><input type="number" min={10} value={form.geofence_radius_meters} onChange={(event) => setField('geofence_radius_meters', event.target.value)} className="input-field" /></label>
          <div className="flex flex-col items-stretch gap-2 md:col-span-2 sm:flex-row sm:items-end xl:col-span-4">
            <button type="button" onClick={useCurrentLocation} className="btn btn-secondary"><MapPin size={18} /> Usar localização</button>
            <button disabled={saving} className="btn btn-primary"><Plus size={18} /> {saving ? 'Salvando' : 'Salvar obra'}</button>
          </div>
        </form>
      )}

      <dl className="worksite-statline" aria-label="Resumo das obras">
        <div><dt><Building2 size={17} /> Obras cadastradas</dt><dd>{worksites.length}</dd></div>
        <div><dt><ShieldCheck size={17} /> Geofences ativos</dt><dd>{worksites.filter((item) => item.active).length}</dd></div>
        <div><dt><MapPin size={17} /> Raio médio</dt><dd>{averageRadius}m</dd></div>
      </dl>

      <section className="worksite-command" aria-labelledby="worksite-command-title">
        <header className="worksite-command-header">
          <div>
            <span className="section-eyebrow"><Building2 size={14} /> Gêmeo digital</span>
            <h2 id="worksite-command-title">Obra em contexto</h2>
            <p>Explore a implantação 3D e confira os sinais operacionais cadastrados para cada local.</p>
          </div>
        </header>

        {selectedWorksite ? (
          <div className="worksite-command-grid">
            <aside className="worksite-portfolio" aria-label="Escolher obra">
              <div className="worksite-selector-heading"><span>Portfólio de obras</span><strong>{String(worksites.length).padStart(2, '0')}</strong></div>
              <div className="worksite-selector-list" role="tablist" aria-orientation="vertical">
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
              <VisibleDigitalTwin key={selectedWorksite.id} worksite={selectedWorksite} />
              <div className="worksite-intelligence">
                <div className="worksite-intelligence-heading">
                  <div><span>{selectedWorksite.code}</span><h3>{selectedWorksite.name}</h3><p><MapPin size={14} /> {selectedWorksite.address}</p></div>
                  <span className={`status-pill ${selectedWorksite.active ? 'status-pill-online' : 'status-pill-neutral'}`}><span className="status-dot" /> {selectedWorksite.active ? 'Operacional' : 'Inativa'}</span>
                </div>
                <dl className="worksite-signal-grid">
                  <div><dt><Activity size={16} /> Movimentações hoje</dt><dd>{selectedMovement}</dd><small>Registros desta obra</small></div>
                  <div><dt><Camera size={16} /> Câmeras e terminais</dt><dd>{selectedDevices.length}</dd><small>{selectedDevices.filter((device) => device.status === 'ACTIVE').length} ativos</small></div>
                  <div><dt><UsersRound size={16} /> Responsável</dt><dd className="is-text">{selectedWorksite.manager_name || 'Não informado'}</dd><small>Cadastro administrativo</small></div>
                  <div><dt><ShieldCheck size={16} /> Área permitida</dt><dd>{selectedWorksite.geofence_radius_meters}<small>m</small></dd><small>Raio da geofence</small></div>
                </dl>
                <div className="worksite-readiness">
                  <span>Prontidão do cadastro</span>
                  <div>
                    <i data-ready={Boolean(selectedWorksite.manager_name)} /> Responsável
                    <i data-ready={selectedWorksite.latitude != null && selectedWorksite.longitude != null} /> Coordenadas
                    <i data-ready={selectedDevices.length > 0} /> Dispositivo
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="worksite-ops-empty">
            <span><Building2 size={24} /></span>
            <div><strong>Nenhuma obra para visualizar</strong><p>Cadastre a primeira obra para ativar o gêmeo digital e configurar a cobertura.</p></div>
            <button type="button" className="btn btn-secondary" onClick={() => setShowForm(true)}><Plus size={17} /> Cadastrar obra</button>
          </div>
        )}
      </section>

      <DataTable
        ariaLabel="Obras cadastradas"
        rows={worksites}
        loading={loading}
        emptyTitle="Nenhuma obra cadastrada"
        emptyDescription="Cadastre a primeira obra para configurar geofence e terminais."
        columns={[
          { key: 'code', header: 'Código' },
          { key: 'name', header: 'Obra' },
          { key: 'address', header: 'Endereço' },
          { key: 'manager_name', header: 'Responsável' },
          { key: 'geofence_radius_meters', header: 'Raio' },
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
