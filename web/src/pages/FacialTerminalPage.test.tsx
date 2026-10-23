import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  employees: vi.fn(), worksites: vi.fn(), faceReadiness: vi.fn(), punchBatch: vi.fn(),
}));
vi.mock('../services/api', () => ({ apiClient: api }));
vi.mock('../presentation/PresentationContext', () => ({
  usePresentationMode: () => ({ active: false }),
}));
vi.mock('../components/CameraCapture', async () => {
  const React = await import('react');
  return {
    CameraCapture: React.forwardRef(function TestCamera(props: {
      onReadyChange: (ready: boolean) => void;
      onFaceCountChange: (count: number) => void;
    }, ref) {
      React.useImperativeHandle(ref, () => ({
        captureFaceSamples: () => [{ image: 'synthetic-frame', box: { x: 0.2, y: 0.2, width: 0.2, height: 0.3 } }],
      }));
      React.useEffect(() => {
        props.onReadyChange(true);
        props.onFaceCountChange(1);
      }, []);
      return null;
    }),
  };
});

import { FacialTerminalPage } from './FacialTerminalPage';

const decision = {
  accepted: true, status: 'ACCEPTED', employee_id: 'employee-1', employee_name: 'Pessoa sintética',
  punch_type: 'ENTRY', reasons: [], email_notification_sent: false,
};
const response = (record?: object) => ({
  decisions: [{ ...decision, record }], processed: 1, accepted: 1, manual_review: 0,
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.employees.mockResolvedValue({ items: [] });
  api.worksites.mockResolvedValue({ items: [{ id: 'worksite-1', name: 'Obra sintética', code: 'TEST', active: true }] });
  api.faceReadiness.mockResolvedValue({});
});
afterEach(cleanup);

describe('confirmação de ponto no terminal', () => {
  it('não confirma reconhecimento sem registro persistido', async () => {
    api.punchBatch.mockResolvedValue(response());
    const view = render(<FacialTerminalPage />);
    await screen.findByText('Registro não concluído');
    expect(view.container.querySelector('.terminal-shell')).toHaveAttribute('data-mode', 'attention');
    expect(screen.queryByText('Entrada registrada com sucesso.')).not.toBeInTheDocument();
  });

  it('confirma somente depois de receber ID e instante do registro', async () => {
    api.punchBatch.mockResolvedValue(response({ id: 'record-1', occurred_at: '2026-10-10T12:00:00Z' }));
    const view = render(<FacialTerminalPage />);
    await waitFor(() => expect(view.container.querySelector('.terminal-shell')).toHaveAttribute('data-mode', 'accepted'));
    expect(api.punchBatch).toHaveBeenCalledTimes(1);
  });

  it('uma resposta tardia não substitui a pausa do operador', async () => {
    let finish!: (value: ReturnType<typeof response>) => void;
    api.punchBatch.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const view = render(<FacialTerminalPage />);
    await waitFor(() => expect(api.punchBatch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Pausar leitura automática' }));
    await act(async () => { finish(response({ id: 'record-1', occurred_at: '2026-10-10T12:00:00Z' })); });
    expect(view.container.querySelector('.terminal-shell')).toHaveAttribute('data-mode', 'paused');
  });
});
