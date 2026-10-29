import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  employees: vi.fn(), worksites: vi.fn(), faceReadiness: vi.fn(), punchBatch: vi.fn(),
}));
const scene = vi.hoisted(() => ({
  presentationActive: false,
  setFaceCount: (_count: number) => undefined as void,
  faces: [{ image: 'synthetic-frame', box: { x: 0.2, y: 0.2, width: 0.2, height: 0.3 } }],
}));
vi.mock('../services/api', () => ({ apiClient: api }));
vi.mock('../presentation/PresentationContext', () => ({
  usePresentationMode: () => ({ active: scene.presentationActive }),
}));
vi.mock('../presentation/PresentationShow', () => ({
  PresentationShow: ({ result }: { result: { participants: { name: string }[] } }) => (
    <div role="dialog" aria-label="Apresentação">
      {result.participants.map((participant) => participant.name).join(' | ')}
    </div>
  ),
}));
vi.mock('../components/CameraCapture', async () => {
  const React = await import('react');
  return {
    CameraCapture: React.forwardRef(function TestCamera(props: {
      onReadyChange: (ready: boolean) => void;
      onFaceCountChange: (count: number) => void;
    }, ref) {
      React.useImperativeHandle(ref, () => ({
        captureFaceSamples: () => scene.faces,
      }));
      React.useEffect(() => {
        scene.setFaceCount = props.onFaceCountChange;
        props.onReadyChange(true);
        props.onFaceCountChange(scene.faces.length);
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
  scene.presentationActive = false;
  scene.faces = [{ image: 'synthetic-frame', box: { x: 0.2, y: 0.2, width: 0.2, height: 0.3 } }];
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

describe('apresentação com mais de um rosto', () => {
  const faceA = { image: 'face-a', box: { x: 0.1, y: 0.2, width: 0.2, height: 0.3 } };
  const faceB = { image: 'face-b', box: { x: 0.6, y: 0.2, width: 0.2, height: 0.3 } };
  const accepted = (id: string, name: string) => ({
    ...decision, employee_id: id, employee_name: name,
    record: { id: `record-${id}`, occurred_at: '2026-10-10T12:00:00Z' },
  });
  const rejected = { accepted: false, status: 'REJECTED', employee_id: null, reasons: ['LOW_SIMILARITY'] };

  beforeEach(() => {
    scene.presentationActive = true;
    scene.faces = [faceA, faceB];
  });

  it('espera reconhecer todos os rostos e mostra o nome de todos', async () => {
    api.punchBatch
      .mockResolvedValueOnce({ decisions: [accepted('a', 'Ana Souza'), rejected], processed: 2, accepted: 1, manual_review: 0 })
      .mockResolvedValueOnce({ decisions: [accepted('b', 'Bruno Lima')], processed: 1, accepted: 1, manual_review: 0 });
    render(<FacialTerminalPage />);

    await waitFor(() => expect(api.punchBatch).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog', { name: 'Apresentação' })).not.toBeInTheDocument();

    const dialog = await screen.findByRole('dialog', { name: 'Apresentação' }, { timeout: 3_000 });
    expect(dialog).toHaveTextContent('Ana Souza | Bruno Lima');
    // A segunda leitura envia somente o rosto que ainda faltava.
    expect(api.punchBatch.mock.calls[1][0]).toHaveLength(1);
    expect(api.punchBatch.mock.calls[1][0][0].face.image_base64).toBe('face-b');
  });

  it('abre com quem foi reconhecido quando um rosto não é identificado a tempo', async () => {
    api.punchBatch
      .mockResolvedValueOnce({ decisions: [accepted('a', 'Ana Souza'), rejected], processed: 2, accepted: 1, manual_review: 0 })
      .mockResolvedValue({ decisions: [rejected], processed: 1, accepted: 0, manual_review: 0 });
    render(<FacialTerminalPage />);

    const dialog = await screen.findByRole('dialog', { name: 'Apresentação' }, { timeout: 6_000 });
    expect(dialog).toHaveTextContent('Ana Souza');
    expect(dialog).not.toHaveTextContent('|');
  }, 10_000);

  it('uma queda momentânea na contagem de rostos não corta o grupo', async () => {
    let finishSecond!: (value: object) => void;
    api.punchBatch
      .mockResolvedValueOnce({ decisions: [accepted('a', 'Ana Souza'), rejected], processed: 2, accepted: 1, manual_review: 0 })
      .mockReturnValueOnce(new Promise((resolve) => { finishSecond = resolve; }));
    render(<FacialTerminalPage />);

    await waitFor(() => expect(api.punchBatch).toHaveBeenCalledTimes(2));
    // O detector do navegador perde o segundo rosto por um instante.
    act(() => scene.setFaceCount(1));
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect(screen.queryByRole('dialog', { name: 'Apresentação' })).not.toBeInTheDocument();

    act(() => scene.setFaceCount(2));
    await act(async () => {
      finishSecond({ decisions: [accepted('b', 'Bruno Lima')], processed: 1, accepted: 1, manual_review: 0 });
    });
    const dialog = await screen.findByRole('dialog', { name: 'Apresentação' }, { timeout: 3_000 });
    expect(dialog).toHaveTextContent('Ana Souza | Bruno Lima');
  }, 10_000);

  it('inclui quem foi registrado para conferência', async () => {
    api.punchBatch.mockResolvedValueOnce({
      decisions: [
        accepted('a', 'Ana Souza'),
        { ...accepted('b', 'Bruno Lima'), accepted: false, status: 'MANUAL_REVIEW' },
      ],
      processed: 2, accepted: 1, manual_review: 1,
    });
    render(<FacialTerminalPage />);

    const dialog = await screen.findByRole('dialog', { name: 'Apresentação' }, { timeout: 3_000 });
    expect(dialog).toHaveTextContent('Ana Souza | Bruno Lima');
    expect(api.punchBatch).toHaveBeenCalledTimes(1);
  });
});
