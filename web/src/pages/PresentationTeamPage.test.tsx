// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PresentationTeamPage } from './PresentationTeamPage';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PresentationTeamPage', () => {
  it('renders the complete project team on a dedicated page', () => {
    render(<PresentationTeamPage />);
    expect(screen.getByRole('heading', { name: /Pessoas por trás da inteligência/i })).toBeInTheDocument();
    expect(screen.getByText('Paulo Ricardo da Silva')).toBeInTheDocument();
    expect(screen.getByText('Alisson Cortati Pereira')).toBeInTheDocument();
    expect(screen.getByText('Murilo Pinheiro Cescon')).toBeInTheDocument();
    expect(screen.getByText('Allanis Cristina Lisboa Francisco')).toBeInTheDocument();
    expect(screen.getByText('Ana Clara Silva Pinheiro')).toBeInTheDocument();
  });

  it('exposes a pause control for continuous motion', () => {
    render(<PresentationTeamPage />);
    expect(screen.getByRole('button', { name: /Pausar movimento/i })).toBeInTheDocument();
  });
});

