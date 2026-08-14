import { Building2, ChevronRight, MapPin, Plus, ScanFace, ShieldCheck } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';

import { DataTable } from '../components/DataTable';
import { MetricCard } from '../components/MetricCard';
import { apiClient } from '../services/api';
import type { Worksite } from '../types/domain';

const initialForm = {
  name: '',
  code: '',
  address: '',
  manager_name: '',
  latitude: '',
  longitude: '',
  geofence_radius_meters: '120',
};

export function WorksitesPage() {
  const [worksites, setWorksites] = useState<Worksite[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [selectedWorksiteId, setSelectedWorksiteId] = useState('');

  const selectedWorksite = worksites.find((item) => item.id === selectedWorksiteId) ?? worksites[0] ?? null;

  const loadWorksites = () => {
    apiClient
      .worksites()
      .then((page) => setWorksites(page.items))
      .catch(() => setMessage('Entre novamente e verifique se a API está online.'));
  };

  useEffect(loadWorksites, []);

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
      loadWorksites();
    } catch {
      setMessage('Não foi possível cadastrar a obra.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="app-view-transition space-y-5">
      <section className="page-actions">
        <button
          onClick={() => setShowForm((value) => !value)}
          className="btn btn-primary"
        >
          <Plus size={18} />
          Nova obra
        </button>
      </section>

      {message && (
        <div className="feedback-banner app-view-transition" role="status">
          {message}
        </div>
      )}

      {showForm && (
        <form onSubmit={onSubmit} className="form-panel app-view-transition md:grid-cols-2 xl:grid-cols-4">
          <label className="field-label">
            <span>Nome</span>
            <input value={form.name} onChange={(event) => setField('name', event.target.value)} required className="input-field" />
          </label>
          <label className="field-label">
            <span>Código</span>
            <input value={form.code} onChange={(event) => setField('code', event.target.value.toUpperCase())} required className="input-field" />
          </label>
          <label className="field-label md:col-span-2">
            <span>Endereço</span>
            <input value={form.address} onChange={(event) => setField('address', event.target.value)} required className="input-field" />
          </label>
          <label className="field-label">
            <span>Responsável</span>
            <input value={form.manager_name} onChange={(event) => setField('manager_name', event.target.value)} className="input-field" />
          </label>
          <label className="field-label">
            <span>Latitude</span>
            <input value={form.latitude} onChange={(event) => setField('latitude', event.target.value)} className="input-field" />
          </label>
          <label className="field-label">
            <span>Longitude</span>
            <input value={form.longitude} onChange={(event) => setField('longitude', event.target.value)} className="input-field" />
          </label>
          <label className="field-label">
            <span>Raio</span>
            <input type="number" min={10} value={form.geofence_radius_meters} onChange={(event) => setField('geofence_radius_meters', event.target.value)} className="input-field" />
          </label>
          <div className="flex flex-col items-stretch gap-2 md:col-span-2 sm:flex-row sm:items-end xl:col-span-4">
            <button type="button" onClick={useCurrentLocation} className="btn btn-secondary">
              <MapPin size={18} />
              Usar localização
            </button>
            <button disabled={saving} className="btn btn-primary">
              <Plus size={18} />
              {saving ? 'Salvando' : 'Salvar obra'}
            </button>
          </div>
        </form>
      )}

      <section className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="Obras cadastradas" value={worksites.length} icon={Building2} tone="gray" />
        <MetricCard label="Geofences ativos" value={worksites.filter((item) => item.active).length} icon={ShieldCheck} tone="green" />
        <MetricCard label="Raio médio" value={`${Math.round(worksites.reduce((acc, item) => acc + item.geofence_radius_meters, 0) / Math.max(worksites.length, 1))}m`} icon={MapPin} tone="blue" />
      </section>

      <section className="worksite-ops-section app-card" aria-labelledby="worksite-ops-heading">
        <header className="worksite-ops-header">
          <div>
            <span className="section-eyebrow"><ShieldCheck size={14} /> Cobertura operacional</span>
            <h2 id="worksite-ops-heading">Acesso e geofence por obra</h2>
            <p>Visão esquemática para conferir o raio permitido e os pontos de operação antes de liberar a equipe.</p>
          </div>
          <span className="worksite-ops-sync"><i /> Dados do cadastro</span>
        </header>

        {selectedWorksite ? (
          <div className="worksite-ops-layout">
            <div className="worksite-ops-selector" role="tablist" aria-label="Escolher obra para visualizar">
              <div className="worksite-selector-heading">
                <span>Obras disponíveis</span>
                <strong>{String(worksites.length).padStart(2, '0')}</strong>
              </div>
              <div className="worksite-selector-list">
                {worksites.map((worksite, index) => {
                  const selected = worksite.id === selectedWorksite.id;
                  return (
                    <button
                      key={worksite.id}
                      id={`worksite-tab-${worksite.id}`}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      aria-controls="worksite-ops-panel"
                      className="worksite-selector-item"
                      data-active={selected}
                      onClick={() => setSelectedWorksiteId(worksite.id)}
                    >
                      <span className="worksite-selector-index">{String(index + 1).padStart(2, '0')}</span>
                      <span className="worksite-selector-copy">
                        <strong>{worksite.name}</strong>
                        <small>{worksite.code} · {worksite.geofence_radius_meters}m</small>
                      </span>
                      <span className="worksite-selector-state" data-online={worksite.active} aria-label={worksite.active ? 'Obra ativa' : 'Obra inativa'} />
                      <ChevronRight size={16} aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
              <p className="worksite-selector-note"><MapPin size={15} /> Selecione uma obra para conferir sua cobertura.</p>
            </div>

            <div
              id="worksite-ops-panel"
              className="worksite-ops-panel"
              role="tabpanel"
              aria-labelledby={`worksite-tab-${selectedWorksite.id}`}
            >
              <div className="worksite-plan" aria-label={`Planta esquemática da obra ${selectedWorksite.name}`}>
                <div className="worksite-plan-grid" aria-hidden="true" />
                <div className="worksite-plan-heading">
                  <span>Planta esquemática</span>
                  <strong>{selectedWorksite.code}</strong>
                </div>
                <div className="worksite-plan-boundary" data-active={selectedWorksite.active}>
                  <span>{selectedWorksite.geofence_radius_meters} m</span>
                </div>
                <div className="worksite-plan-building">
                  <Building2 size={24} aria-hidden="true" />
                  <span>Frente de obra</span>
                </div>
                <div className="worksite-plan-gate"><ShieldCheck size={18} aria-hidden="true" /><span>Acesso</span></div>
                <div className="worksite-plan-terminal"><ScanFace size={18} aria-hidden="true" /><span>Terminal facial</span></div>
                <div className="worksite-plan-legend">
                  <span><i data-tone="coverage" /> Limite da geofence</span>
                  <span><i data-tone="terminal" /> Ponto de registro</span>
                </div>
              </div>
              <dl className="worksite-ops-metadata">
                <div><dt>Endereço</dt><dd>{selectedWorksite.address}</dd></div>
                <div><dt>Responsável</dt><dd>{selectedWorksite.manager_name || 'Não informado'}</dd></div>
                <div><dt>Geofence</dt><dd>{selectedWorksite.geofence_radius_meters} metros</dd></div>
              </dl>
            </div>
          </div>
        ) : (
          <div className="worksite-ops-empty">
            <span><Building2 size={24} /></span>
            <div><strong>Nenhuma obra para visualizar</strong><p>Cadastre a primeira obra para configurar sua cobertura operacional.</p></div>
            <button type="button" className="btn btn-secondary" onClick={() => setShowForm(true)}><Plus size={17} /> Cadastrar obra</button>
          </div>
        )}
      </section>

      <DataTable
        ariaLabel="Obras cadastradas"
        rows={worksites}
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
