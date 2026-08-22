import { Inbox } from 'lucide-react';
import { useRef, type ReactNode } from 'react';

import { useTableMotion } from '../animations/useMotion';

interface DataTableColumn<T> {
  key: keyof T | string;
  header: string;
  render?: (row: T) => ReactNode;
  mobileHidden?: boolean;
  mobilePrimary?: boolean;
}

interface DataTableProps<T> {
  columns: Array<DataTableColumn<T>>;
  rows: T[];
  ariaLabel?: string;
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}

export function DataTable<T extends { id: string }>({
  columns,
  rows,
  ariaLabel = 'Tabela de dados',
  loading = false,
  emptyTitle = 'Nenhum registro encontrado',
  emptyDescription = 'Os dados aparecerão aqui assim que forem cadastrados.',
}: DataTableProps<T>) {
  const tableRef = useRef<HTMLDivElement>(null);
  const rowMotionKey = rows.slice(0, 12).map((row) => row.id).join('|');
  useTableMotion(tableRef, rowMotionKey);

  return (
    <div ref={tableRef} className="table-shell app-view-transition">
      <div className="data-table-scroll">
        <table className="data-table" aria-label={ariaLabel}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={String(column.key)}
                  scope="col"
                  className={column.mobileHidden ? 'data-table-column-mobile-hidden' : undefined}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && Array.from({ length: 5 }).map((_, rowIndex) => (
              <tr key={`skeleton-${rowIndex}`} aria-hidden="true">
                {columns.map((column, columnIndex) => (
                  <td
                    key={`${String(column.key)}-${columnIndex}`}
                    className={column.mobileHidden ? 'data-table-column-mobile-hidden' : undefined}
                    data-label={column.header}
                  >
                    <span className="table-cell-skeleton" style={{ width: `${52 + ((rowIndex + columnIndex) % 4) * 11}%` }} />
                  </td>
                ))}
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td className="data-table-empty-cell" colSpan={columns.length}>
                  <div className="data-table-empty">
                    <span className="data-table-empty-icon" aria-hidden="true">
                      <Inbox size={21} />
                    </span>
                    <strong>{emptyTitle}</strong>
                    <small>{emptyDescription}</small>
                  </div>
                </td>
              </tr>
            )}
            {!loading && rows.map((row) => (
              <tr key={row.id}>
                {columns.map((column) => (
                  <td
                    key={String(column.key)}
                    className={[
                      'whitespace-nowrap',
                      column.mobileHidden ? 'data-table-column-mobile-hidden' : '',
                      column.mobilePrimary ? 'data-table-column-mobile-primary' : '',
                    ].filter(Boolean).join(' ')}
                    data-label={column.header}
                  >
                    {column.render ? column.render(row) : String(row[column.key as keyof T] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
