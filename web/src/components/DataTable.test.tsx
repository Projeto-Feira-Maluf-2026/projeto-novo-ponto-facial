import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../animations/useMotion', () => ({ useTableMotion: () => undefined }));

import { DataTable } from './DataTable';

type TestRow = { id: string; name: string };

const columns = [{ key: 'name' as const, header: 'Nome' }];

describe('DataTable', () => {
  it('renderiza skeletons enquanto os dados carregam', () => {
    const { container } = render(<DataTable<TestRow> rows={[]} columns={columns} loading />);

    expect(container.querySelectorAll('.table-cell-skeleton')).toHaveLength(5);
    expect(screen.queryByText('Nenhum registro encontrado')).not.toBeInTheDocument();
  });

  it('expõe um estado vazio específico e acessível', () => {
    render(
      <DataTable<TestRow>
        rows={[]}
        columns={columns}
        ariaLabel="Equipe"
        emptyTitle="Nenhum funcionário"
        emptyDescription="Cadastre a primeira pessoa."
      />,
    );

    expect(screen.getByRole('table', { name: 'Equipe' })).toBeInTheDocument();
    expect(screen.getByText('Nenhum funcionário')).toBeInTheDocument();
    expect(screen.getByText('Cadastre a primeira pessoa.')).toBeInTheDocument();
  });
});
