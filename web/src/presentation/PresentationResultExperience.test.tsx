// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./PresentationCinematicLayer', () => ({
  PresentationCinematicLayer: () => <div className="presentation-cinematic-layer" data-webgl="true" />,
}));

import {
  PresentationResultExperience,
  PresentationResultSummary,
} from './PresentationResultExperience';
import {
  shouldOfferPresentationResult,
  type PresentationParticipantResult,
  type PresentationResult,
} from './presentationResult';
import { consumeQueuedPresentationResult } from './presentationResultTransfer';

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
  consumeQueuedPresentationResult();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('PresentationResultExperience', () => {
  it('starts only for accepted presentation results', () => {
    expect(shouldOfferPresentationResult(false, [participant])).toBe(false);
    expect(shouldOfferPresentationResult(true, [])).toBe(false);
    expect(shouldOfferPresentationResult(true, [participant])).toBe(true);
  });

  it('enters the summary route immediately without a confirmation prompt', async () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter initialEntries={['/terminal-facial']}>
        <Routes>
          <Route
            path="/terminal-facial"
            element={<PresentationResultExperience result={result} onClose={onClose} />}
          />
          <Route path="/apresentacao/resumo" element={<h1>Resumo automático</h1>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Resumo automático' })).toBeInTheDocument());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(consumeQueuedPresentationResult()).toEqual(result);
  });

  it('starts the cinematic experience without activation or pause controls', () => {
    render(<PresentationResultSummary result={result} onClose={() => undefined} />);

    expect(screen.getByRole('heading', { name: /Você acabou de atravessar um sistema inteiro/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ativar experiência completa/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pausar movimento/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Continuar movimento/i })).not.toBeInTheDocument();
  });

  it('keeps the team inside chapter 06 instead of linking to a separate page', () => {
    render(<PresentationResultSummary result={result} onClose={() => undefined} />);

    const team = screen.getByRole('list', { name: 'Integrantes do projeto' });
    expect(screen.getByText('06 / QUEM CONSTRUIU')).toBeInTheDocument();
    expect(team).toHaveTextContent('Paulo Ricardo da Silva');
    expect(team).toHaveTextContent('Ana Clara Silva Pinheiro');
    expect(screen.queryByRole('link', { name: 'Equipe' })).not.toBeInTheDocument();
    expect(document.querySelector('.presentation-chapter-rail')).toBeNull();
  });

  it('keeps the first frame focused on the left copy and the persistent 3D layer', async () => {
    const { container } = render(<PresentationResultSummary result={result} onClose={() => undefined} />);

    expect(container.querySelector('.presentation-story-hero-copy')).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector('.presentation-cinematic-layer')).toBeInTheDocument());
    expect(container.querySelector('.presentation-data-sculpture')).not.toBeInTheDocument();
    expect(screen.queryByText('CAPTURA')).not.toBeInTheDocument();
    expect(screen.queryByText('MATCH')).not.toBeInTheDocument();
    expect(screen.queryByText('REGISTRO')).not.toBeInTheDocument();
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
