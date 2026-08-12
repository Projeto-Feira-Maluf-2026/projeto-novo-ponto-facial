import {
  Camera,
  CheckCircle2,
  Eye,
  HardDrive,
  Play,
  RefreshCcw,
  Router,
  Save,
  ShieldCheck,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';

import { CameraCapture } from '../components/CameraCapture';
import { DataTable } from '../components/DataTable';
import { MetricCard } from '../components/MetricCard';
import { apiClient } from '../services/api';
import type { CameraConfig, CameraTestResponse, Device, Worksite } from '../types/domain';

const cameraTypes = [
  { value: 'WEBCAM', label: 'Webcam local' },
  { value: 'RTSP', label: 'Câmera RTSP' },
  { value: 'ONVIF', label: 'ONVIF' },
  { value: 'INTELBRAS', label: 'Intelbras' },
  { value: 'HIKVISION', label: 'Hikvision' },
  { value: 'DAHUA', label: 'Dahua' },
  { value: 'GENERIC', label: 'Genérica' },
];

const initialCamera: CameraConfig = {
  camera_type: 'WEBCAM',
  protocol: 'LOCAL',
  ip_address: '',
  port: null,
  username: '',
  password: '',
  rtsp_url: '',
  location_label: '',
  recognition_enabled: true,
  developer_debug: false,
};

function generateDeviceApiKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function createInitialForm() {
  return {
    name: '',
    serial_number: '',
    worksite_id: '',
    api_key: generateDeviceApiKey(),
    camera: { ...initialCamera },
  };
}

type CameraForm = ReturnType<typeof createInitialForm>;

function statusPill(status: Device['status']) {
  if (status === 'ACTIVE') return 'status-pill-online';
  if (status === 'MAINTENANCE') return 'status-pill-warn';
  return 'status-pill-danger';
}

export function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [worksites, setWorksites] = useState<Worksite[]>([]);
  const [form, setForm] = useState<CameraForm>(() => createInitialForm());
  const [selected, setSelected] = useState<Device | null>(null);
  const [message, setMessage] = useState('');
  const [testResult, setTestResult] = useState<CameraTestResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);

  const loadDevices = () => {
    apiClient
      .devices()
      .then((page) => {
        setDevices(page.items);
        setSelected((current) => current ?? page.items[0] ?? null);
      })
      .catch(() => setMessage('Entre novamente e verifique se a API está online.'));
  };

  useEffect(() => {
    loadDevices();
    apiClient
      .worksites()
      .then((page) => {
        setWorksites(page.items);
        setForm((current) => ({ ...current, worksite_id: current.worksite_id || page.items[0]?.id || '' }));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const selectedCamera = selected?.metadata_json?.camera;
  const activeCount = devices.filter((item) => item.status === 'ACTIVE').length;
  const offlineCount = devices.filter((item) => item.status !== 'ACTIVE').length;

  const step = useMemo(() => {
    if (!form.camera.camera_type) return 1;
    if (form.camera.camera_type !== 'WEBCAM' && !form.camera.rtsp_url && !form.camera.ip_address) return 2;
    if (!testResult?.ok) return 3;
    if (!form.worksite_id) return 4;
    return 5;
  }, [form, testResult]);

  const setField = (field: keyof CameraForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const setCameraField = (field: keyof CameraConfig, value: string | number | boolean | null) => {
    setForm((current) => ({ ...current, camera: { ...current.camera, [field]: value } }));
    setTestResult(null);
  };

  const chooseType = (cameraType: string) => {
    const protocol = cameraType === 'WEBCAM' ? 'LOCAL' : 'RTSP';
    setForm((current) => ({
      ...current,
      camera: {
        ...current.camera,
        camera_type: cameraType,
        protocol,
        port: protocol === 'RTSP' ? 554 : current.camera.port,
      },
    }));
    setTestResult(null);
  };

  const testCurrentCamera = async () => {
    setTesting(true);
    setMessage('');
    try {
      const result = await apiClient.testCamera(form.camera);
      setTestResult(result);
      setMessage(result.message);
    } catch {
      setMessage('Não foi possível testar a câmera.');
    } finally {
      setTesting(false);
    }
  };

  const saveCamera = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      const saved = await apiClient.createDevice({
        worksite_id: form.worksite_id,
        name: form.name,
        serial_number: form.serial_number || `CAM-${Date.now()}`,
        api_key: form.api_key,
        status: testResult?.status ?? 'ACTIVE',
        camera: form.camera,
      });
      setSelected(saved);
      setForm(createInitialForm());
      setTestResult(null);
      setMessage('Câmera salva e pronta para leitura facial.');
      loadDevices();
    } catch {
      setMessage('Não foi possível salvar a câmera.');
    } finally {
      setSaving(false);
    }
  };

  const loadPreview = async (device: Device) => {
    setSelected(device);
    setMessage('');
    if (device.metadata_json?.camera?.camera_type === 'WEBCAM') {
      setPreviewUrl('');
      return;
    }
    setPreviewLoading(true);
    try {
      const url = await apiClient.cameraSnapshot(device.id);
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return url;
      });
    } catch {
      setPreviewUrl('');
      setMessage('Não foi possível carregar a prévia da câmera.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const testSavedCamera = async (device: Device) => {
    setTesting(true);
    setMessage('');
    try {
      const result = await apiClient.testSavedCamera(device.id);
      setMessage(result.message);
      loadDevices();
    } catch {
      setMessage('Não foi possível testar a câmera salva.');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="app-view-transition space-y-5">
      <section className="page-actions">
        <button onClick={() => selected && loadPreview(selected)} className="btn btn-primary">
          <RefreshCcw size={18} />
          Atualizar prévia
        </button>
      </section>

      {message && (
        <div className="feedback-banner app-view-transition" role="status">
          {message}
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-4">
        <MetricCard label="Câmeras" value={devices.length} icon={HardDrive} tone="gray" />
        <MetricCard label="Online" value={activeCount} icon={Wifi} tone="green" />
        <MetricCard label="Offline" value={offlineCount} icon={WifiOff} tone="red" />
        <MetricCard label="Leitura habilitada" value={devices.filter((item) => item.metadata_json?.camera?.recognition_enabled).length} icon={ShieldCheck} tone="blue" />
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <form onSubmit={saveCamera} className="app-card configuration-panel app-view-transition space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold">Configurar câmera</h3>
              <p className="text-sm text-steel dark:text-slate-400">Etapa {step} de 5</p>
            </div>
            {testResult?.ok && <CheckCircle2 className="text-limeSafe" size={24} />}
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {cameraTypes.map((item) => (
              <button
                type="button"
                key={item.value}
                onClick={() => chooseType(item.value)}
                className="choice-card"
                data-active={form.camera.camera_type === item.value}
                aria-pressed={form.camera.camera_type === item.value}
              >
                {item.value === 'WEBCAM' ? <Camera size={17} /> : <Router size={17} />}
                {item.label}
              </button>
            ))}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="field-label">
              <span>Nome da câmera</span>
              <input value={form.name} onChange={(event) => setField('name', event.target.value)} required className="input-field" />
            </label>
            <label className="field-label">
              <span>Serial</span>
              <input value={form.serial_number} onChange={(event) => setField('serial_number', event.target.value)} placeholder="CAM-PORTARIA-01" className="input-field" />
            </label>
            <label className="field-label">
              <span>Obra vinculada</span>
              <select value={form.worksite_id} onChange={(event) => setField('worksite_id', event.target.value)} required className="input-field">
                <option value="">Selecione</option>
                {worksites.map((worksite) => (
                  <option key={worksite.id} value={worksite.id}>
                    {worksite.code} - {worksite.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              <span>Local</span>
              <input value={form.camera.location_label ?? ''} onChange={(event) => setCameraField('location_label', event.target.value)} placeholder="Portaria principal" className="input-field" />
            </label>
          </div>

          {form.camera.camera_type !== 'WEBCAM' && (
            <div className="grid gap-3 md:grid-cols-2">
              <label className="field-label">
                <span>Protocolo</span>
                <select value={form.camera.protocol} onChange={(event) => setCameraField('protocol', event.target.value)} className="input-field">
                  <option value="RTSP">RTSP</option>
                  <option value="HTTP">HTTP</option>
                  <option value="HTTPS">HTTPS</option>
                  <option value="ONVIF">ONVIF</option>
                </select>
              </label>
              <label className="field-label">
                <span>IP</span>
                <input value={form.camera.ip_address ?? ''} onChange={(event) => setCameraField('ip_address', event.target.value)} placeholder="192.168.0.120" className="input-field" />
              </label>
              <label className="field-label">
                <span>Porta</span>
                <input type="number" value={form.camera.port ?? ''} onChange={(event) => setCameraField('port', event.target.value ? Number(event.target.value) : null)} placeholder="554" className="input-field" />
              </label>
              <label className="field-label">
                <span>Usuario</span>
                <input value={form.camera.username ?? ''} onChange={(event) => setCameraField('username', event.target.value)} className="input-field" />
              </label>
              <label className="field-label">
                <span>Senha</span>
                <input type="password" value={form.camera.password ?? ''} onChange={(event) => setCameraField('password', event.target.value)} className="input-field" />
              </label>
              <label className="field-label md:col-span-2">
                <span>URL RTSP</span>
                <input value={form.camera.rtsp_url ?? ''} onChange={(event) => setCameraField('rtsp_url', event.target.value)} placeholder="rtsp://usuario:senha@ip:554/caminho" className="input-field" />
              </label>
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button type="button" onClick={testCurrentCamera} disabled={testing} className="btn btn-secondary">
              <Play size={18} />
              {testing ? 'Testando' : 'Testar câmera'}
            </button>
            <button disabled={saving || !form.worksite_id} className="btn btn-primary">
              <Save size={18} />
              {saving ? 'Salvando' : 'Salvar câmera'}
            </button>
          </div>
        </form>

        <div className="space-y-4">
          <DataTable
            ariaLabel="Câmeras cadastradas"
            rows={devices}
            columns={[
              { key: 'name', header: 'Câmera' },
              {
                key: 'metadata_json',
                header: 'Tipo',
                render: (row) => row.metadata_json?.camera?.camera_type ?? 'WEBCAM',
              },
              {
                key: 'location',
                header: 'Local',
                render: (row) => row.metadata_json?.camera?.location_label ?? '-',
              },
              {
                key: 'status',
                header: 'Status',
                render: (row) => (
                  <span className={`status-pill ${statusPill(row.status)}`}>
                    <span className="status-dot" />
                    {row.status === 'ACTIVE' ? 'Online' : row.status === 'MAINTENANCE' ? 'Atenção' : 'Offline'}
                  </span>
                ),
              },
              {
                key: 'actions',
                header: '',
                render: (row) => (
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => loadPreview(row)} className="icon-button" title="Ver prévia" aria-label={`Ver prévia de ${row.name}`}>
                      <Eye size={16} />
                    </button>
                    <button type="button" onClick={() => testSavedCamera(row)} className="icon-button" title="Testar câmera" aria-label={`Testar ${row.name}`}>
                      <RefreshCcw size={16} />
                    </button>
                  </div>
                ),
              },
            ]}
          />
        </div>
      </section>

      <section className="app-card app-view-transition p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">Prévia da câmera</h3>
            <p className="text-sm text-steel dark:text-slate-400">{selected ? selected.name : 'Selecione uma câmera salva'}</p>
          </div>
          <span className={`status-pill ${selected ? statusPill(selected.status) : 'status-pill-neutral'}`}>
            <span className={`status-dot ${selected?.status === 'ACTIVE' ? 'status-dot-pulse' : ''}`} />
            {selected?.status === 'ACTIVE' ? 'Online' : selected ? 'Verificar' : 'Aguardando'}
          </span>
        </div>
        <div className="camera-view grid min-h-[420px] place-items-center text-white">
          {selectedCamera?.camera_type === 'WEBCAM' ? (
            <CameraCapture className="h-[520px] w-full" />
          ) : previewUrl ? (
            <img src={previewUrl} alt="" className="h-[520px] w-full object-cover" />
          ) : (
            <div className="text-center">
              <Camera size={46} className="mx-auto text-white/50" />
              <p className="mt-3 text-sm font-semibold text-white/80">{previewLoading ? 'Carregando prévia' : 'Selecione uma câmera para visualizar'}</p>
            </div>
          )}
          <div className="camera-chip absolute left-4 top-4">
            {selected ? 'Câmera selecionada' : 'Prévia'}
          </div>
        </div>
      </section>
    </div>
  );
}
