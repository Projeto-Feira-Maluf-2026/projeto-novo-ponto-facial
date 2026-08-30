import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';

import { supabase } from './supabase';

import type {
  AttendanceDecision,
  AttendanceBatchDecision,
  AttendanceRecord,
  AuditLog,
  CameraConfig,
  CameraTestResponse,
  DashboardMetrics,
  Device,
  Employee,
  EnrollmentCapturePayload,
  EnrollmentCaptureResponse,
  EnrollmentFinalizeResponse,
  EnrollmentSampleResponse,
  EnrollmentSessionResponse,
  FaceAnalyzeResponse,
  FaceCapabilitiesResponse,
  FaceIdentifyResponse,
  FaceIdentifyBatchResponse,
  FaceVerifyResponse,
  Page,
  PunchType,
  Worksite,
} from '../types/domain';

const DEFAULT_API_URL = '/api/v1';

function isLoopbackHost(hostname: string) {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '[::1]';
}

export function resolveApiBaseUrl(configured: string | undefined, fallback: string) {
  const candidate = (configured?.trim() || fallback).replace(/\/+$/, '');
  if (!candidate.startsWith('/') && !/^https?:\/\//i.test(candidate)) {
    console.warn(`URL de API invalida; usando ${fallback}.`);
    return fallback;
  }
  if (typeof window === 'undefined') return candidate;

  const target = new URL(candidate, window.location.origin);
  const pageIsLoopback = isLoopbackHost(window.location.hostname);
  if (!pageIsLoopback && isLoopbackHost(target.hostname)) {
    console.warn(`API configurada para ${target.hostname} fora do ambiente local; usando ${fallback}.`);
    return fallback;
  }
  if (window.location.protocol === 'https:' && target.protocol === 'http:') {
    console.warn(`API HTTP bloqueada em pagina HTTPS; usando ${fallback}.`);
    return fallback;
  }
  return candidate;
}

const apiBaseUrl = resolveApiBaseUrl(import.meta.env.VITE_API_URL, DEFAULT_API_URL);
const faceApiBaseUrl = resolveApiBaseUrl(import.meta.env.VITE_FACE_API_URL, apiBaseUrl);

function createApi(baseURL: string, timeout: number): AxiosInstance {
  const client = axios.create({ baseURL, timeout });
  type RetryableRequest = InternalAxiosRequestConfig & { _retriedOnce?: boolean };

  client.interceptors.request.use(async (config) => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

  client.interceptors.response.use(
    (response) => {
      const contentType = String(response.headers['content-type'] ?? '');
      if (contentType.includes('text/html')) {
        return Promise.reject(new Error('API_ROUTE_RETURNED_HTML'));
      }
      return response;
    },
    async (error) => {
      if (error.response?.status === 401) {
        void supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
      }
      const config = error.config as RetryableRequest | undefined;
      const method = String(config?.method || 'get').toLowerCase();
      const status = Number(error.response?.status || 0);
      const transientFailure = [502, 503, 504].includes(status)
        || (!error.response && ['ECONNABORTED', 'ERR_NETWORK'].includes(String(error.code)));
      if (config && method === 'get' && transientFailure && !config._retriedOnce) {
        config._retriedOnce = true;
        await new Promise((resolve) => window.setTimeout(resolve, 450));
        return client.request(config);
      }
      return Promise.reject(error);
    },
  );

  return client;
}

const api = createApi(apiBaseUrl, 20_000);
const faceApi = createApi(faceApiBaseUrl, 45_000);

const enableMocks = import.meta.env.VITE_ENABLE_MOCKS === 'true';

const fallbackMetrics: DashboardMetrics = {
  total_employees: 1264,
  present_employees: 982,
  absent_employees: 282,
  records_today: 2338,
  worked_hours_today: 7842.5,
  worksites: 18,
  connected_devices: 41,
  fraud_alerts: 7,
  by_worksite: [
    { name: 'Obra Batel', records: 416 },
    { name: 'Canteiro CIC', records: 374 },
    { name: 'Reforma Centro', records: 291 },
    { name: 'Araucaria Norte', records: 188 },
  ],
  timeline: [
    { hour: '06:00', records: 412 },
    { hour: '07:00', records: 638 },
    { hour: '08:00', records: 242 },
    { hour: '11:00', records: 525 },
    { hour: '12:00', records: 486 },
    { hour: '17:00', records: 640 },
  ],
};

const fallbackEmployees: Page<Employee> = {
  page: 1,
  size: 10,
  total: 4,
  items: [
    { id: '1', registration: 'CE-1001', name: 'Joao Pereira', email: 'joao@curitiba.com', status: 'ACTIVE', biometric_reenrollment_required: false, created_at: '2026-06-01', updated_at: '2026-06-12' },
    { id: '2', registration: 'CE-1002', name: 'Maria Santos', email: 'maria@curitiba.com', status: 'ACTIVE', biometric_reenrollment_required: false, created_at: '2026-06-01', updated_at: '2026-06-12' },
    { id: '3', registration: 'CE-1003', name: 'Ana Clara Lima', email: 'ana@curitiba.com', status: 'ON_LEAVE', biometric_reenrollment_required: false, created_at: '2026-06-01', updated_at: '2026-06-12' },
    { id: '4', registration: 'CE-1004', name: 'Murilo Rocha', email: 'murilo@curitiba.com', status: 'ACTIVE', biometric_reenrollment_required: false, created_at: '2026-06-01', updated_at: '2026-06-12' },
  ],
};

const fallbackWorksites: Page<Worksite> = {
  page: 1,
  size: 10,
  total: 3,
  items: [
    { id: 'w1', name: 'Obra Batel', code: 'BATEL', address: 'Av. do Batel, Curitiba', manager_name: 'Paulo', active: true, created_at: '2026-06-01', updated_at: '2026-06-12' },
    { id: 'w2', name: 'Canteiro CIC', code: 'CIC', address: 'Cidade Industrial, Curitiba', manager_name: 'Alisson', active: true, created_at: '2026-06-01', updated_at: '2026-06-12' },
    { id: 'w3', name: 'Reforma Centro', code: 'CENTRO', address: 'Centro, Curitiba', manager_name: 'Allannis', active: true, created_at: '2026-06-01', updated_at: '2026-06-12' },
  ],
};

const fallbackDevices: Page<Device> = {
  page: 1,
  size: 10,
  total: 3,
  items: [
    { id: 'd1', worksite_id: 'w1', name: 'Tablet Portaria 01', serial_number: 'TAB-BATEL-01', status: 'ACTIVE', last_seen_at: new Date().toISOString() },
    { id: 'd2', worksite_id: 'w2', name: 'Totem Entrada Norte', serial_number: 'TOT-CIC-02', status: 'ACTIVE', last_seen_at: new Date().toISOString() },
    { id: 'd3', worksite_id: 'w3', name: 'Mobile Supervisor', serial_number: 'MOB-CEN-07', status: 'MAINTENANCE', last_seen_at: null },
  ],
};

async function fallback<T>(request: Promise<{ data: T }>, value: T): Promise<T> {
  if (enableMocks) {
    void request.catch(() => undefined);
    return value;
  }
  try {
    const response = await request;
    return response.data;
  } catch {
    throw new Error('API indisponivel');
  }
}

export interface EmployeeCreatePayload {
  registration: string;
  name: string;
  document?: string | null;
  phone?: string | null;
  email?: string | null;
  worksite_ids: string[];
  status?: Employee['status'];
}

export interface EmployeeUpdatePayload {
  name?: string;
  email?: string | null;
  status?: Employee['status'];
  worksite_ids?: string[];
}

export interface ReportExportPayload {
  kind: 'daily' | 'weekly' | 'monthly' | 'employee' | 'worksite' | 'custom';
  format: 'pdf' | 'xlsx' | 'csv';
  starts_at: string;
  ends_at: string;
  employee_id?: string | null;
  worksite_id?: string | null;
}

export interface WorksiteCreatePayload {
  name: string;
  code: string;
  address: string;
  manager_name?: string | null;
  active: boolean;
}

export interface DeviceCreatePayload {
  worksite_id: string;
  name: string;
  serial_number: string;
  api_key: string;
  status: Device['status'];
  camera: CameraConfig;
}

export interface PunchPayload {
  employee_id?: string | null;
  worksite_id: string;
  device_id?: string | null;
  punch_type?: PunchType | null;
  face: {
    image_base64?: string;
    images_base64?: string[];
  };
  offline_batch_id?: string | null;
  occurred_at?: string | null;
}

export const apiClient = {
  dashboard: () => fallback(api.get<DashboardMetrics>('/dashboard'), fallbackMetrics),
  employees: () => fallback(api.get<Page<Employee>>('/employees?size=20'), fallbackEmployees),
  worksites: () => fallback(api.get<Page<Worksite>>('/worksites?size=20'), fallbackWorksites),
  devices: () => fallback(api.get<Page<Device>>('/devices?size=20'), fallbackDevices),
  createDevice: async (payload: DeviceCreatePayload) => {
    const response = await api.post<Device>('/devices', payload);
    return response.data;
  },
  testCamera: async (camera: CameraConfig) => {
    const response = await faceApi.post<CameraTestResponse>('/devices/test-camera', { camera });
    return response.data;
  },
  testSavedCamera: async (deviceId: string) => {
    const response = await faceApi.post<CameraTestResponse>(`/devices/${deviceId}/test`);
    return response.data;
  },
  cameraSnapshot: async (deviceId: string) => {
    const response = await faceApi.get<Blob>(`/devices/${deviceId}/snapshot`, { responseType: 'blob' });
    return URL.createObjectURL(response.data);
  },
  createEmployee: async (payload: EmployeeCreatePayload) => {
    const response = await api.post<Employee>('/employees', payload);
    return response.data;
  },
  updateEmployee: async (employeeId: string, payload: EmployeeUpdatePayload) => {
    const response = await api.patch<Employee>(`/employees/${employeeId}`, payload);
    return response.data;
  },
  deleteEmployee: async (employeeId: string) => {
    await api.delete(`/employees/${employeeId}`);
  },
  createWorksite: async (payload: WorksiteCreatePayload) => {
    const response = await api.post<Worksite>('/worksites', payload);
    return response.data;
  },
  faceCapabilities: async () => {
    const response = await faceApi.get<FaceCapabilitiesResponse>('/ai/capabilities');
    return response.data;
  },
  analyzeFace: async (imageBase64: string) => {
    const response = await faceApi.post<FaceAnalyzeResponse>('/ai/analyze-face', {
      image_base64: imageBase64,
    });
    return response.data;
  },
  identifyFace: async (imageBase64: string, worksiteId?: string | null, signal?: AbortSignal) => {
    const response = await faceApi.post<FaceIdentifyResponse>('/ai/identify-face', {
      image_base64: imageBase64,
      worksite_id: worksiteId || null,
    }, { signal });
    return response.data;
  },
  verifyFace: async (imageBase64: string, employeeId: string, signal?: AbortSignal) => {
    const response = await faceApi.post<FaceVerifyResponse>('/ai/verify-face', {
      image_base64: imageBase64,
      employee_id: employeeId,
    }, { signal });
    return response.data;
  },
  startFaceEnrollment: async (employeeId: string) => {
    const response = await faceApi.post<EnrollmentSessionResponse>(
      `/employees/${employeeId}/face-enrollment-sessions`,
    );
    return response.data;
  },
  validateFaceEnrollmentCapture: async (
    employeeId: string,
    sessionId: string,
    payload: EnrollmentCapturePayload,
  ) => {
    const response = await faceApi.post<EnrollmentCaptureResponse>(
      `/employees/${employeeId}/face-enrollment-sessions/${sessionId}/captures`,
      payload,
    );
    return response.data;
  },
  collectFaceEnrollmentSample: async (
    employeeId: string,
    sessionId: string,
    frame: { image_base64: string; captured_at: string },
  ) => {
    const response = await faceApi.post<EnrollmentSampleResponse>(
      `/employees/${employeeId}/face-enrollment-sessions/${sessionId}/samples`,
      { frame },
    );
    return response.data;
  },
  finalizeFaceEnrollment: async (
    employeeId: string,
    sessionId: string,
    captures: EnrollmentCapturePayload[] = [],
  ) => {
    const response = await faceApi.post<EnrollmentFinalizeResponse>(
      `/employees/${employeeId}/face-enrollment-sessions/${sessionId}/finalize`,
      { captures },
    );
    return response.data;
  },
  cancelFaceEnrollment: async (employeeId: string, sessionId: string) => {
    const response = await faceApi.delete(
      `/employees/${employeeId}/face-enrollment-sessions/${sessionId}`,
    );
    return response.data;
  },
  punch: async (payload: PunchPayload) => {
    const response = await faceApi.post<AttendanceDecision>('/attendance/punch', payload);
    return response.data;
  },
  identifyFaces: async (imagesBase64: string[], worksiteId?: string | null, signal?: AbortSignal) => {
    const response = await faceApi.post<FaceIdentifyBatchResponse>('/ai/identify-faces', {
      images_base64: imagesBase64,
      worksite_id: worksiteId || null,
    }, { signal });
    return response.data;
  },
  employeePhoto: async (employeeId: string) => {
    const response = await api.get<Blob>(`/employees/${employeeId}/photo/content`, {
      responseType: 'blob',
    });
    return response.data;
  },
  punchBatch: async (punches: PunchPayload[]) => {
    const response = await faceApi.post<AttendanceBatchDecision>('/attendance/punch/batch', {
      punches,
    });
    return response.data;
  },
  attendanceHistory: async (worksiteId?: string | null) => {
    const params = worksiteId ? `?worksite_id=${encodeURIComponent(worksiteId)}` : '';
    const response = await api.get<AttendanceRecord[]>(`/attendance/history${params}`);
    return response.data;
  },
  auditLogs: async () => {
    const response = await api.get<Page<AuditLog>>('/audit?size=100');
    return response.data;
  },
  exportReport: async (payload: ReportExportPayload) => {
    const response = await api.post<Blob>('/reports/export', payload, { responseType: 'blob' });
    const disposition = String(response.headers['content-disposition'] ?? '');
    const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const basicName = disposition.match(/filename="?([^";]+)"?/i)?.[1];
    const filename = encodedName
      ? decodeURIComponent(encodedName)
      : basicName || `relatorio-ponto.${payload.format}`;
    return { blob: response.data, filename };
  },
};
