import { describe, expect, it } from 'vitest';

import { cameraAccessErrorMessage } from './CameraCapture';

describe('cameraAccessErrorMessage', () => {
  it('orienta a liberar a permissão quando o navegador bloqueia a câmera', () => {
    expect(cameraAccessErrorMessage({ name: 'NotAllowedError' })).toContain('cadeado');
  });

  it('diferencia webcam ausente de webcam ocupada', () => {
    expect(cameraAccessErrorMessage({ name: 'NotFoundError' })).toContain('Nenhuma webcam');
    expect(cameraAccessErrorMessage({ name: 'NotReadableError' })).toContain('ocupada');
  });

  it('explica quando o acesso exige HTTPS', () => {
    expect(cameraAccessErrorMessage({ name: 'SecurityError' })).toContain('HTTPS');
  });
});
