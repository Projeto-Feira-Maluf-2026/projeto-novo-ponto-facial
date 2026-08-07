import { Download, FileSpreadsheet, FileText, Filter } from 'lucide-react';
import { useState } from 'react';

import { apiClient } from '../services/api';

export function ReportsPage() {
  const [format, setFormat] = useState<'pdf' | 'xlsx' | 'csv'>('pdf');

  const exportReport = async () => {
    const response = await apiClient.exportReport(format);
    const url = URL.createObjectURL(response.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = `relatorio-ponto.${format}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="app-view-transition space-y-5">
      <section className="form-panel app-view-transition lg:grid-cols-4">
        <label className="field-label">
          <span>Tipo</span>
          <select className="input-field">
            <option>Mensal</option>
            <option>Semanal</option>
            <option>Diário</option>
            <option>Funcionário</option>
            <option>Obra</option>
          </select>
        </label>
        <label className="field-label">
          <span>Início</span>
          <input type="date" className="input-field" />
        </label>
        <label className="field-label">
          <span>Fim</span>
          <input type="date" className="input-field" />
        </label>
        <label className="field-label">
          <span>Formato</span>
          <div className="segmented-control w-full">
            {(['pdf', 'xlsx', 'csv'] as const).map((item) => (
              <button key={item} onClick={() => setFormat(item)} className="segmented-button flex-1 uppercase" data-active={format === item}>
                {item}
              </button>
            ))}
          </div>
        </label>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <button onClick={() => setFormat('pdf')} className={`app-card app-view-transition flex items-center gap-3 p-4 text-left ${format === 'pdf' ? 'border-emerald-700 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-950/20' : ''}`}>
          <FileText className="text-slate-600 dark:text-slate-300" />
          <span><strong className="block">PDF</strong><span className="text-sm text-steel dark:text-slate-400">Auditoria e assinatura</span></span>
        </button>
        <button onClick={() => setFormat('xlsx')} className={`app-card app-view-transition flex items-center gap-3 p-4 text-left ${format === 'xlsx' ? 'border-emerald-700 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-950/20' : ''}`}>
          <FileSpreadsheet className="text-emerald-700 dark:text-emerald-300" />
          <span><strong className="block">Excel</strong><span className="text-sm text-steel dark:text-slate-400">Fechamento de folha</span></span>
        </button>
        <button onClick={() => setFormat('csv')} className={`app-card app-view-transition flex items-center gap-3 p-4 text-left ${format === 'csv' ? 'border-emerald-700 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-950/20' : ''}`}>
          <Filter className="text-slate-600 dark:text-slate-300" />
          <span><strong className="block">CSV</strong><span className="text-sm text-steel dark:text-slate-400">Integrações externas</span></span>
        </button>
      </section>

      <button onClick={exportReport} className="btn btn-primary">
        <Download size={18} />
        Exportar relatório
      </button>
    </div>
  );
}
