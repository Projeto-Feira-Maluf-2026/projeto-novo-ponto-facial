// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PresentationResultExperience,
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

afterEach(() => cleanup());

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

  it('opens the immersive summary and exposes a motion pause control', () => {
    render(<PresentationResultExperience result={result} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /Ver meu resumo/i }));

    expect(screen.getByRole('dialog', { name: /Você acabou de atravessar um sistema inteiro/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Pausar movimento/i }));
    expect(screen.getByRole('button', { name: /Continuar movimento/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('closes from Escape without submitting another action', () => {
    const onClose = vi.fn();
    render(<PresentationResultExperience result={result} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps keyboard focus inside the prompt', () => {
    render(<PresentationResultExperience result={result} onClose={() => undefined} />);
    const primaryAction = screen.getByRole('button', { name: /Ver meu resumo/i });
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
      <PresentationResultExperience
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
    fireEvent.click(screen.getByRole('button', { name: /Ver meu resumo/i }));

    const participantList = screen.getByRole('list', { name: /Participantes confirmados/i });
    expect(participantList).toHaveTextContent('Ana Participante');
    expect(participantList).toHaveTextContent('Bruno Participante');
    expect(participantList).toHaveTextContent('E-mail enviado');
    expect(participantList).toHaveTextContent('Registro confirmado');
  });
});
