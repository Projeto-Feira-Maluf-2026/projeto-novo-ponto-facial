// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PresentationResultExperience,
  PresentationResultSummary,
} from './PresentationResultExperience';
import {
  shouldOfferPresentationResult,
  type PresentationParticipantResult,
  type PresentationResult,
} from './presentationResult';

const participant: PresentationParticipantResult = {
  id: 'record-1',
  name: 'Ana Participante',
  registration: 'FEIRA-001',
  punchType: 'ENTRY',
  occurredAt: new Date('2026-08-30T15:20:00-03:00'),
  emailSent: true,
};

const result: PresentationResult = {
  worksiteName: 'Obra Feira de Tecnologia',
  worksiteCode: 'FEIRA-01',
  participants: [participant],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('PresentationResultExperience', () => {
  it('offers the summary only for accepted presentation results', () => {
    expect(shouldOfferPresentationResult(false, [participant])).toBe(false);
    expect(shouldOfferPresentationResult(true, [])).toBe(false);
    expect(shouldOfferPresentationResult(true, [participant])).toBe(true);
  });

  it('starts with an optional confirmation prompt using the real record', () => {
    render(<PresentationResultExperience result={result} onClose={() => undefined} />);

    expect(screen.getByRole('dialog', { name: /Ana Participante, seu ponto foi registrado/i })).toBeInTheDocument();
    expect(screen.getByText('Obra Feira de Tecnologia')).toBeInTheDocument();
    expect(screen.getByText('Entrada')).toBeInTheDocument();
    expect(screen.queryByText(/Você acabou de atravessar um sistema inteiro/i)).not.toBeInTheDocument();
  });

  it('renders the invitation in a body portal above the terminal tree', () => {
    const { container } = render(<PresentationResultExperience result={result} onClose={() => undefined} />);
    expect(container.querySelector('.presentation-result-backdrop')).toBeNull();
    expect(document.body.querySelector('.presentation-result-backdrop')).toBeInTheDocument();
  });

  it('opens the summary in a separate page', () => {
    class FakeBroadcastChannel {
      onmessage: ((event: MessageEvent) => void) | null = null;
      constructor(public name: string) {}
      postMessage() {}
      close() {}
    }
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    const onClose = vi.fn();
    render(<PresentationResultExperience result={result} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Abrir meu resumo/i }));

    expect(open).toHaveBeenCalledTimes(1);
    expect(String(open.mock.calls[0]?.[0])).toContain('/apresentacao/resumo?session=');
    expect(open.mock.calls[0]?.[1]).toBe('_blank');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the modal open and explains how to recover when pop-ups are blocked', () => {
    class FakeBroadcastChannel {
      onmessage: ((event: MessageEvent) => void) | null = null;
      postMessage() {}
      close() {}
    }
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
    vi.spyOn(window, 'open').mockReturnValue(null);
    const onClose = vi.fn();
    render(<PresentationResultExperience result={result} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Abrir meu resumo/i }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/Permita pop-ups/i);
  });

  it('exposes a motion pause control in the standalone summary', () => {
    render(<PresentationResultSummary result={result} onClose={() => undefined} />);

    expect(screen.getByRole('heading', { name: /Você acabou de atravessar um sistema inteiro/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Pausar movimento/i }));
    expect(screen.getByRole('button', { name: /Continuar movimento/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('offers an explicit full-motion recovery when the operating system reduces motion', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const { container } = render(<PresentationResultSummary result={result} onClose={() => undefined} />);

    const enable = screen.getByRole('button', { name: /Ativar experiência completa/i });
    expect(enable).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(enable);
    expect(screen.getByRole('button', { name: /Pausar movimento/i })).toHaveAttribute('aria-pressed', 'false');
    expect(container.querySelector('.presentation-story')).toHaveAttribute('data-motion-override', 'true');
  });

  it('closes from Escape without submitting another action', () => {
    const onClose = vi.fn();
    render(<PresentationResultExperience result={result} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps keyboard focus inside the prompt', () => {
    render(<PresentationResultExperience result={result} onClose={() => undefined} />);
    const primaryAction = screen.getByRole('button', { name: /Abrir meu resumo/i });
    const secondaryAction = screen.getByRole('button', { name: /Agora não/i });
    expect(primaryAction).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(secondaryAction).toHaveFocus();
  });

  it('restores focus to the terminal control after closing', () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Abrir experiência</button>
          {open && <PresentationResultExperience result={result} onClose={() => setOpen(false)} />}
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Abrir experiência' });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Agora não' }));
    expect(trigger).toHaveFocus();
  });

  it('lists every confirmed participant from a collective reading', () => {
    render(
      <PresentationResultSummary
        result={{
          ...result,
          participants: [
            participant,
            {
              ...participant,
              id: 'record-2',
              name: 'Bruno Participante',
              registration: 'FEIRA-002',
              emailSent: false,
            },
          ],
        }}
        onClose={() => undefined}
      />,
    );

    const participantList = screen.getByRole('list', { name: /Participantes confirmados/i });
    expect(participantList).toHaveTextContent('Ana Participante');
    expect(participantList).toHaveTextContent('Bruno Participante');
    expect(participantList).toHaveTextContent('E-mail enviado');
    expect(participantList).toHaveTextContent('Registro confirmado');
  });
});
