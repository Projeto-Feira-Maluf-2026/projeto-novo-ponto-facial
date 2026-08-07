export type PunchType = 'ENTRY' | 'LUNCH_OUT' | 'LUNCH_IN' | 'EXIT';
export type AttendanceStatus = 'ACCEPTED' | 'REJECTED' | 'MANUAL_REVIEW' | 'OFFLINE_PENDING';

export interface DashboardMetrics {
  total_employees: number;
  present_employees: number;
  absent_employees: number;
  records_today: number;
  worked_hours_today: number;
  worksites: number;
  connected_devices: number;
  fraud_alerts: number;
  by_worksite: Array<{ name: string; records: number }>;
  timeline: Array<{ hour: string; records: number }>;
}

export interface Employee {
  id: string;
  registration: string;
  name: string;
  email?: string | null;
  department_id?: string | null;
  job_role_id?: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'ON_LEAVE';
  photo_url?: string | null;
  consent_biometric_at?: string | null;
  biometric_reenrollment_required: boolean;
  biometric_reenrollment_reason?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Worksite {
  id: string;
  name: string;
  code: string;
  address: string;
  manager_name?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  geofence_radius_meters: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Device {
  id: string;
  worksite_id: string;
  name: string;
  serial_number: string;
  status: 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE';
  last_seen_at?: string | null;
  metadata_json?: {
    camera?: CameraConfig;
    [key: string]: unknown;
  } | null;
}

export interface AttendanceRecord {
  id: string;
  employee_id: string;
  worksite_id: string;
  device_id?: string | null;
  punch_type: PunchType;
  status: AttendanceStatus;
  occurred_at: string;
  confidence_score?: number | null;
  similarity_score?: number | null;
  liveness_score?: number | null;
}

export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
  source_width: number;
  source_height: number;
}

export interface FaceAnalyzeResponse {
  request_id: string;
  accepted: boolean;
  face_count: number;
  landmark_count: number;
  quality_score: number;
  detection_score?: number | null;
  pose?: {
    yaw: number;
    pitch: number;
    roll: number;
    method: string;
  } | null;
  landmarks: Array<{ x: number; y: number }>;
  liveness_evaluated: boolean;
  liveness_score?: number | null;
  face_box?: FaceBox | null;
  reasons: string[];
  model_name?: string | null;
  model_version?: string | null;
  detector_name?: string | null;
  normalization_version?: string | null;
  execution_provider?: string | null;
  embedding_dimension?: number | null;
  quality: {
    accepted: boolean;
    score: number;
    reasons: string[];
    metrics: {
      blur_variance: number;
      luminance_mean: number;
      contrast_stddev: number;
      dark_pixel_ratio: number;
      bright_pixel_ratio: number;
      face_area_ratio?: number | null;
      center_offset?: number | null;
      landmark_visibility_ratio?: number | null;
      yaw_degrees?: number | null;
      pitch_degrees?: number | null;
      roll_degrees?: number | null;
      occlusion_score?: number | null;
      eyes_closed?: boolean | null;
    };
    threshold_profile: string;
    thresholds_calibrated: boolean;
    limitations: string[];
  };
  timings: {
    inference_ms: number;
    total_ms: number;
  };
}

export interface FaceIdentifyResponse extends FaceAnalyzeResponse {
  matched: boolean;
  employee_id?: string | null;
  employee_name?: string | null;
  employee_registration?: string | null;
  employee_photo_url?: string | null;
  similarity_score?: number | null;
  second_best_similarity_score?: number | null;
  match_margin?: number | null;
  match_confidence_score?: number | null;
  candidate_count: number;
  templates_used: number;
  centroid_score?: number | null;
  robust_score?: number | null;
  aggregation_strategy: string;
}

export interface FaceVerifyResponse extends FaceAnalyzeResponse {
  verified: boolean;
  employee_id: string;
  employee_name?: string | null;
  employee_registration?: string | null;
  employee_photo_url?: string | null;
  similarity_score?: number | null;
  match_confidence_score?: number | null;
  templates_used: number;
  centroid_score?: number | null;
  robust_score?: number | null;
  aggregation_strategy: string;
}

export interface AttendanceDecision {
  accepted: boolean;
  status: AttendanceStatus;
  employee_id?: string | null;
  employee_name?: string | null;
  employee_registration?: string | null;
  employee_photo_url?: string | null;
  punch_type?: PunchType | null;
  confidence_score: number;
  similarity_score?: number | null;
  second_best_similarity_score?: number | null;
  match_margin?: number | null;
  match_confidence_score?: number | null;
  liveness_evaluated: boolean;
  liveness_score?: number | null;
  quality_score?: number | null;
  reasons: string[];
  record?: AttendanceRecord | null;
}

export type EnrollmentPose = 'FRONTAL' | 'TURN_LEFT' | 'TURN_RIGHT' | 'LOOK_UP' | 'FRONTAL_FINAL';
export type EnrollmentState =
  | 'WAITING_FACE'
  | 'ALIGN_FACE'
  | 'MOVE_CLOSER'
  | 'MOVE_AWAY'
  | 'IMPROVE_LIGHTING'
  | 'LOOK_FORWARD'
  | 'TURN_LEFT'
  | 'TURN_RIGHT'
  | 'LOOK_UP'
  | 'HOLD_STILL'
  | 'CAPTURED'
  | 'DUPLICATE_CAPTURE'
  | 'COMPLETED'
  | 'FAILED';

export interface EnrollmentFramePayload {
  image_base64: string;
  captured_at: string;
}

export interface EnrollmentCapturePayload {
  step_index: number;
  pose: EnrollmentPose;
  frames: EnrollmentFramePayload[];
}

export interface EnrollmentSessionResponse {
  session_id: string;
  employee_id: string;
  state: EnrollmentState;
  expected_pose: EnrollmentPose;
  required_poses: EnrollmentPose[];
  minimum_frames_per_pose: number;
  maximum_frames_per_pose: number;
  minimum_burst_span_ms: number;
  expires_at: string;
  model_name: string;
  model_version: string;
  embedding_dimension: number;
}

export interface EnrollmentCaptureResponse {
  session_id: string;
  accepted: boolean;
  state: EnrollmentState;
  step_index: number;
  pose: EnrollmentPose;
  next_pose?: EnrollmentPose | null;
  instruction: string;
  reasons: string[];
  quality_score?: number | null;
  burst_similarity_median?: number | null;
  observed_yaw?: number | null;
  observed_pitch?: number | null;
  observed_roll?: number | null;
}

export interface EnrollmentFinalizeResponse {
  session_id: string;
  employee_id: string;
  templates_created: number;
  model_name: string;
  model_version: string;
  embedding_dimension: number;
  detector_name: string;
  normalization_version: string;
  quality_average: number;
  consistency: {
    pair_count: number;
    minimum_similarity: number;
    median_similarity: number;
    similarity_stddev: number;
    outlier_steps: number[];
  };
  completed_at: string;
}

export interface CameraConfig {
  camera_type: string;
  protocol: string;
  ip_address?: string | null;
  port?: number | null;
  username?: string | null;
  password?: string | null;
  rtsp_url?: string | null;
  location_label?: string | null;
  recognition_enabled: boolean;
  developer_debug: boolean;
}

export interface CameraTestResponse {
  ok: boolean;
  status: Device['status'];
  source: string;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  message: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
}
