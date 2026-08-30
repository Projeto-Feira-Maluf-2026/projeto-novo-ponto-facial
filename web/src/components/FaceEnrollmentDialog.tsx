import {
  AlertCircle,
  Camera,
  Check,
  CheckCircle2,
  LoaderCircle,
  Pause,
  Play,
  X,
} from 'lucide-react';
import type { RefObject } from 'react';

import { CameraCapture, type CameraCaptureHandle } from './CameraCapture';
import type { Employee, EnrollmentSampleResponse, EnrollmentSessionResponse } from '../types/domain';

interface FaceEnrollmentDialogProps {
  employee: Employee;
  dialogRef: RefObject<HTMLDivElement>;
  closeButtonRef: RefObject<HTMLButtonElement>;
  cameraRef: RefObject<CameraCaptureHandle>;
  session: EnrollmentSessionResponse | null;
  complete: boolean;
  sampleResult: EnrollmentSampleResponse | null;
  capturePreview?: string;
  feedback: string;
  saving: boolean;
  cameraReady: boolean;
  facePresent: boolean;
  autoCaptureEnabled: boolean;
  captureRejected: boolean;
  onClose: () => void;
  onToggleAutoCapture: () => void;
  onCapture: () => void;
  onFinalize: () => void;
  onCameraReadyChange: (ready: boolean) => void;
  onFacePresenceChange: (present: boolean) => void;
}

export function FaceEnrollmentDialog({
  employee,
  dialogRef,
  closeButtonRef,
  cameraRef,
  session,
  complete,
  sampleResult,
  capturePreview,
  feedback,
  saving,
  cameraReady,
  facePresent,
  autoCaptureEnabled,
  captureRejected,
  onClose,
  onToggleAutoCapture,
  onCapture,
  onFinalize,
  onCameraReadyChange,
  onFacePresenceChange,
}: FaceEnrollmentDialogProps) {
  return (
    <div ref={dialogRef} className="modal-backdrop">
      <section
        className="enrollment-dialog app-card text-ink dark:text-slate-100"
        data-complete={complete}
        role="dialog"
        aria-modal="true"
        aria-labelledby="enrollment-dialog-title"
      >
        <header className="enrollment-dialog-header">
          <div>
            <p className="text-xs font-medium text-steel dark:text-slate-400">Cadastro facial</p>
            <h2 id="enrollment-dialog-title" className="mt-0.5 text-lg font-semibold">{employee.name}</h2>
            <p className="text-xs text-steel dark:text-slate-400">
              {employee.registration} · uma foto nítida é suficiente
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`status-pill ${session && autoCaptureEnabled ? 'status-pill-online' : 'status-pill-neutral'}`}>
              <span className={`status-dot ${session && autoCaptureEnabled ? 'status-dot-pulse' : ''}`} />
              {session ? (autoCaptureEnabled ? 'Automático' : 'Pausado') : 'Aguardando API'}
            </span>
            <button
              type="button"
              onClick={onToggleAutoCapture}
              disabled={!session}
              className="icon-button"
              title={autoCaptureEnabled ? 'Pausar captura' : 'Retomar captura'}
              aria-label={autoCaptureEnabled ? 'Pausar captura automática' : 'Retomar captura automática'}
            >
              {autoCaptureEnabled ? <Pause size={17} /> : <Play size={17} />}
            </button>
            <button ref={closeButtonRef} type="button" onClick={onClose} className="icon-button" title="Fechar" aria-label="Fechar cadastro facial">
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="enrollment-dialog-body">
          <div className="enrollment-camera-column">
            {session ? (
              <CameraCapture
                ref={cameraRef}
                className="enrollment-camera"
                onReadyChange={onCameraReadyChange}
                onFacePresenceChange={onFacePresenceChange}
                faceOverlay={{
                  label: complete ? 'Foto aprovada' : feedback || 'Olhe de frente para a câmera',
                  tone: captureRejected ? 'warning' : complete ? 'success' : 'tracking',
                }}
              />
            ) : (
              <div className="enrollment-camera grid place-items-center bg-slate-950 px-8 text-center text-white">
                <div className="grid max-w-sm justify-items-center gap-3">
                  {saving ? <LoaderCircle size={32} className="animate-spin" /> : <AlertCircle size={32} className="text-amber-300" />}
                  <strong>{saving ? 'Verificando o backend facial' : 'Câmera não iniciada'}</strong>
                  <span className="text-sm text-slate-300">A câmera só será aberta depois que a API confirmar que o modelo facial está pronto.</span>
                </div>
              </div>
            )}
            <div className="enrollment-camera-caption">
              <div className="flex items-center gap-2">
                <span className={`enrollment-presence-dot ${cameraReady && facePresent ? 'is-ready' : ''}`} />
                <strong>
                  {!session
                    ? saving ? 'Verificando backend' : 'Backend facial indisponível'
                    : !cameraReady
                      ? 'Iniciando câmera'
                      : facePresent
                        ? saving ? 'Capturando' : 'Rosto detectado'
                        : 'Entre no enquadramento'}
                </strong>
              </div>
              <span>{session ? 'A foto só é usada quando nitidez, luz e posição estiverem adequadas.' : 'Nenhuma imagem foi capturada ou enviada.'}</span>
            </div>
          </div>

          <aside className="enrollment-side-panel">
            <div className={`enrollment-instruction ${captureRejected ? 'is-warning' : complete ? 'is-success' : ''}`} aria-live="polite">
              <div className="enrollment-instruction-icon">
                {saving ? <LoaderCircle size={20} className="animate-spin" /> : captureRejected ? <AlertCircle size={20} /> : complete ? <Check size={20} /> : <Camera size={20} />}
              </div>
              <div>
                <span>{complete ? 'Finalizando cadastro' : saving ? 'Analisando foto' : 'Pronto para fotografar'}</span>
                <strong>{feedback}</strong>
              </div>
            </div>

            {sampleResult && (
              <dl className="enrollment-diagnostics" aria-label="Diagnóstico da última leitura">
                <div><dt>Qualidade</dt><dd>{Math.round((sampleResult.quality_score || 0) * 100)}%</dd></div>
                <div><dt>Rosto no quadro</dt><dd>{((sampleResult.face_area_ratio || 0) * 100).toFixed(1)}%</dd></div>
                <div><dt>Luz</dt><dd>{Math.round(sampleResult.luminance_mean || 0)}</dd></div>
                <div><dt>Processamento</dt><dd>{Math.round(sampleResult.processing_ms || 0)} ms</dd></div>
              </dl>
            )}

            <div className="enrollment-steps" aria-label="Foto do cadastro facial">
              <div className={`enrollment-step ${capturePreview ? 'is-complete' : 'is-active'}`}>
                {capturePreview ? <img src={capturePreview} alt="Foto facial aprovada" width="640" height="640" /> : <Camera size={20} />}
                <div>
                  <strong>{capturePreview ? 'Foto selecionada' : 'Aguardando foto'}</strong>
                  <small>{capturePreview ? 'Qualidade aprovada' : 'Olhe de frente para a câmera'}</small>
                </div>
                {capturePreview && <CheckCircle2 size={17} />}
              </div>
            </div>

            <div className="mt-auto grid gap-2">
              {!autoCaptureEnabled && !complete && (
                <button type="button" onClick={onCapture} disabled={saving || !session || !facePresent} className="btn btn-primary w-full">
                  <Camera size={18} /> Capturar agora
                </button>
              )}
              {complete && captureRejected && (
                <button type="button" onClick={onFinalize} disabled={saving} className="btn btn-primary w-full">
                  <CheckCircle2 size={18} /> Tentar finalizar novamente
                </button>
              )}
              <p className="text-xs leading-5 text-steel dark:text-slate-400">Mantenha o rosto de frente, sem óculos escuros e com luz uniforme. O sistema fotografa assim que a imagem estiver adequada.</p>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
