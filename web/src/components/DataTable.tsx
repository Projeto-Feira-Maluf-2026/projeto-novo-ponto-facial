import { Inbox } from 'lucide-react';
import { useRef, type ReactNode } from 'react';

import { useTableMotion } from '../animations/useMotion';

interface DataTableProps<T> {
  columns: Array<{ key: keyof T | string; header: string; render?: (row: T) => ReactNode }>;
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
      <div className="overflow-x-auto">
        <table className="data-table" aria-label={ariaLabel}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={String(column.key)} scope="col">
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && Array.from({ length: 5 }).map((_, rowIndex) => (
              <tr key={`skeleton-${rowIndex}`} aria-hidden="true">
                {columns.map((column, columnIndex) => (
                  <td key={`${String(column.key)}-${columnIndex}`}>
                    <span className="table-cell-skeleton" style={{ width: `${52 + ((rowIndex + columnIndex) % 4) * 11}%` }} />
                  </td>
                ))}
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={columns.length}>
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
                  <td key={String(column.key)} className="whitespace-nowrap">
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
