import { AlertCircle, RefreshCcw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { DataTable } from '../components/DataTable';
import { apiClient } from '../services/api';
import type { AuditLog } from '../types/domain';
import { parseApiDate } from '../utils/dateTime';

const actionLabels: Record<string, string> = {
  'attendance.punch': 'Ponto registrado',
  'attendance.correct': 'Ponto corrigido',
};

function formatAuditDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(parseApiDate(value));
}

export function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadLogs = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const page = await apiClient.auditLogs();
      setLogs(page.items);
      setError('');
    } catch {
      setError('Não foi possível carregar o histórico de auditoria.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLogs(true);
    const refresh = () => {
      if (document.visibilityState === 'visible') void loadLogs();
    };
    const timer = window.setInterval(refresh, 4_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [loadLogs]);

  return (
    <div className="app-view-transition space-y-4">
      <section className="toolbar-panel">
        <div>
          <strong>Operações recentes</strong>
          <p className="text-sm text-muted">Registros e correções ficam associados ao usuário responsável.</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => void loadLogs(true)} disabled={loading}>
          <RefreshCcw size={17} className={loading ? 'animate-spin' : ''} />
          Atualizar
        </button>
      </section>

      {error && (
        <div className="feedback-banner is-error" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      <DataTable
        ariaLabel="Histórico de auditoria"
        loading={loading}
        rows={logs}
        emptyTitle="Nenhuma operação auditada"
        emptyDescription="As próximas batidas e correções aparecerão aqui."
        columns={[
          {
            key: 'created_at',
            header: 'Data e hora',
            mobilePrimary: true,
            render: (row) => formatAuditDate(row.created_at),
          },
          {
            key: 'action',
            header: 'Operação',
            render: (row) => actionLabels[row.action] || row.action,
          },
          {
            key: 'entity_id',
            header: 'Registro',
            mobileHidden: true,
            render: (row) => row.entity_id || '—',
          },
          {
            key: 'actor_user_id',
            header: 'Responsável',
            mobileHidden: true,
            render: (row) => row.actor_user_id || 'Sistema',
          },
        ]}
      />
    </div>
  );
}
