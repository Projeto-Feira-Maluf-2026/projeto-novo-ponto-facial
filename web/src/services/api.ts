import axios, { type AxiosInstance } from 'axios';

import { supabase } from './supabase';

import type {
  AttendanceDecision,
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

function createApi(baseURL: string): AxiosInstance {
  const client = axios.create({ baseURL });

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
      return Promise.reject(error);
    },
  );

  return client;
}

const api = createApi(apiBaseUrl);
const faceApi = createApi(faceApiBaseUrl);

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
    { id: 'w1', name: 'Obra Batel', code: 'BATEL', address: 'Av. do Batel, Curitiba', manager_name: 'Paulo', latitude: -25.443, longitude: -49.287, geofence_radius_meters: 120, active: true, created_at: '2026-06-01', updated_at: '2026-06-12' },
    { id: 'w2', name: 'Canteiro CIC', code: 'CIC', address: 'Cidade Industrial, Curitiba', manager_name: 'Alisson', latitude: -25.49, longitude: -49.35, geofence_radius_meters: 180, active: true, created_at: '2026-06-01', updated_at: '2026-06-12' },
    { id: 'w3', name: 'Reforma Centro', code: 'CENTRO', address: 'Centro, Curitiba', manager_name: 'Allannis', latitude: -25.428, longitude: -49.273, geofence_radius_meters: 90, active: true, created_at: '2026-06-01', updated_at: '2026-06-12' },
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
  try {
    const response = await request;
    return response.data;
  } catch {
    if (!enableMocks) {
      throw new Error('API indisponivel');
    }
    return value;
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

export interface WorksiteCreatePayload {
  name: string;
  code: string;
  address: string;
  manager_name?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  geofence_radius_meters: number;
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
  location?: { latitude: number; longitude: number } | null;
  face: {
    image_base64?: string;
    images_base64?: string[];
  };
  offline_batch_id?: string | null;
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
  exportReport: (format: 'pdf' | 'xlsx' | 'csv') =>
    api.post('/reports/export', {
      kind: 'monthly',
      format,
      starts_at: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString(),
      ends_at: new Date().toISOString(),
    }, { responseType: 'blob' }),
};
