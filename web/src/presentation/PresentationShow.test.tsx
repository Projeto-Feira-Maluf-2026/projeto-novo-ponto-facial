// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PresentationShow } from './PresentationShow';
import {
  firstName,
  joinNames,
  shouldOfferPresentationResult,
  type PresentationParticipantResult,
  type PresentationResult,
} from './presentationResult';

const participant: PresentationParticipantResult = {
  id: 'record-1',
  name: 'Ana Clara Participante',
  registration: 'FEIRA-001',
  punchType: 'ENTRY',
  occurredAt: new Date('2026-10-22T15:20:00-03:00'),
  email: 'queued',
};

const result: PresentationResult = {
  worksiteName: 'Feira de Tecnologia',
  worksiteCode: 'FEIRA-01',
  participants: [participant],
};

let frameCallbacks = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;
let now = 0;

function advance(ms: number) {
  const steps = Math.ceil(ms / 50);
  for (let step = 0; step < steps; step += 1) {
    now += 50;
    const pending = [...frameCallbacks.values()];
    frameCallbacks = new Map();
    act(() => pending.forEach((callback) => callback(now)));
  }
}

beforeEach(() => {
  now = 0;
  nextFrameId = 1;
  frameCallbacks = new Map();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextFrameId;
    nextFrameId += 1;
    frameCallbacks.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frameCallbacks.delete(id);
  });
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function activeScene(container: HTMLElement) {
  return container.querySelector('.show-scene[data-state="active"]');
}

describe('PresentationShow', () => {
  it('only opens for confirmed results while presentation mode is on', () => {
    expect(shouldOfferPresentationResult(false, [participant])).toBe(false);
    expect(shouldOfferPresentationResult(true, [])).toBe(false);
    expect(shouldOfferPresentationResult(true, [participant])).toBe(true);
  });

  it('greets a single person by first name with a human message', () => {
    const { container } = render(<PresentationShow result={result} onClose={() => undefined} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(activeScene(container)).toHaveTextContent('Oi, Ana!');
    expect(activeScene(container)).toHaveTextContent('Que bom ter você aqui');
    expect(screen.getByText(/Ponto registrado às 15:20/)).toBeInTheDocument();
  });

  it('greets a group and lists everyone who was recognized', () => {
    const { container } = render(
      <PresentationShow
        result={{
          ...result,
          participants: [participant, { ...participant, id: 'record-2', name: 'Bruno Costa', email: 'none' }],
        }}
        onClose={() => undefined}
      />,
    );

    expect(activeScene(container)).toHaveTextContent('Oi, pessoal!');
    expect(activeScene(container)).toHaveTextContent('reconheceu Ana e Bruno de uma vez só');
    const people = screen.getByRole('list', { name: 'Pessoas reconhecidas' });
    expect(people).toHaveTextContent('Ana Clara Participante');
    expect(people).toHaveTextContent('Bruno Costa');
  });

  it('advances on its own and closes after the last scene', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const onClose = vi.fn();
    const { container } = render(<PresentationShow result={result} onClose={onClose} />);

    advance(7_100);
    expect(activeScene(container)).toHaveTextContent('Primeiro, a câmera');

    advance(90_000);
    act(() => { vi.runAllTimers(); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('can be paused, navigated and closed from the keyboard', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const onClose = vi.fn();
    const { container } = render(<PresentationShow result={result} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Pausar apresentação' }));
    advance(20_000);
    expect(activeScene(container)).toHaveTextContent('Oi, Ana!');

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(activeScene(container)).toHaveTextContent('Primeiro, a câmera');

    fireEvent.keyDown(window, { key: 'Escape' });
    act(() => { vi.runAllTimers(); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('describes the e-mail honestly: on the way is not the same as delivered', () => {
    const { container, rerender } = render(<PresentationShow result={result} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ir para a cena 5 de 9' }));
    expect(activeScene(container)).toHaveTextContent('a confirmação já está a caminho do seu e-mail');

    rerender(<PresentationShow result={{ ...result, participants: [{ ...participant, email: 'sent' }] }} onClose={() => undefined} />);
    expect(activeScene(container)).toHaveTextContent('já mandamos a confirmação para o seu e-mail');

    rerender(<PresentationShow result={{ ...result, participants: [{ ...participant, email: 'none' }] }} onClose={() => undefined} />);
    expect(activeScene(container)).not.toHaveTextContent('já mandamos');
  });

  it('credits the five real team members', () => {
    render(<PresentationShow result={result} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ir para a cena 8 de 9' }));
    const team = screen.getByRole('list', { name: 'Integrantes do projeto' });
    expect(team).toHaveTextContent('Paulo Ricardo da Silva');
    expect(team).toHaveTextContent('Ana Clara Silva Pinheiro');
    expect(team.querySelectorAll('li')).toHaveLength(5);
  });

  it('starts in the light version and remembers the dark switch', () => {
    localStorage.removeItem('curitiba:presentation-theme');
    const { unmount } = render(<PresentationShow result={result} onClose={() => undefined} />);
    expect(screen.getByRole('dialog')).toHaveAttribute('data-show-theme', 'light');

    fireEvent.click(screen.getByRole('button', { name: 'Usar versão escura' }));
    expect(screen.getByRole('dialog')).toHaveAttribute('data-show-theme', 'dark');
    unmount();

    render(<PresentationShow result={result} onClose={() => undefined} />);
    expect(screen.getByRole('dialog')).toHaveAttribute('data-show-theme', 'dark');
    fireEvent.click(screen.getByRole('button', { name: 'Usar versão clara' }));
    expect(screen.getByRole('dialog')).toHaveAttribute('data-show-theme', 'light');
  });

  it('formats names for natural sentences', () => {
    expect(firstName('  Maria   Souza ')).toBe('Maria');
    expect(joinNames(['Ana'])).toBe('Ana');
    expect(joinNames(['Ana', 'Bruno', 'Carla'])).toBe('Ana, Bruno e Carla');
  });
});
