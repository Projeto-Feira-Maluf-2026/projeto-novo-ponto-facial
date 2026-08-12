import { Building2, MapPin, Plus, ShieldCheck } from 'lucide-react';
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
