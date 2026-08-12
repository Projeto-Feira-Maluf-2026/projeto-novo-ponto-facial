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

  const options = [
    { key: 'pdf' as const, label: 'PDF', description: 'Auditoria e assinatura', icon: FileText },
    { key: 'xlsx' as const, label: 'Excel', description: 'Fechamento de folha', icon: FileSpreadsheet },
    { key: 'csv' as const, label: 'CSV', description: 'Integrações externas', icon: Filter },
  ];

  return (
    <div className="app-view-transition space-y-5">
      <section className="form-panel app-view-transition lg:grid-cols-4">
        <label className="field-label">
          <span>Tipo</span>
          <select className="input-field">
            <option>Mensal</option><option>Semanal</option><option>Diário</option><option>Funcionário</option><option>Obra</option>
          </select>
        </label>
        <label className="field-label"><span>Início</span><input type="date" className="input-field" /></label>
        <label className="field-label"><span>Fim</span><input type="date" className="input-field" /></label>
        <label className="field-label">
          <span>Formato</span>
          <div className="segmented-control w-full">
            {(['pdf', 'xlsx', 'csv'] as const).map((item) => (
              <button key={item} type="button" onClick={() => setFormat(item)} className="segmented-button flex-1 uppercase" data-active={format === item} aria-pressed={format === item}>{item}</button>
            ))}
          </div>
        </label>
      </section>

      <section className="grid gap-3 md:grid-cols-3" aria-label="Opções de exportação">
        {options.map(({ key, label, description, icon: Icon }) => (
          <button key={key} type="button" onClick={() => setFormat(key)} className="report-format-card app-view-transition" data-active={format === key} aria-pressed={format === key}>
            <span className="report-format-icon"><Icon size={20} /></span>
            <span><strong>{label}</strong><small>{description}</small></span>
            <span className="report-format-check" aria-hidden="true" />
          </button>
        ))}
      </section>

      <div className="page-actions">
        <button type="button" onClick={exportReport} className="btn btn-primary"><Download size={18} /> Exportar relatório</button>
      </div>
    </div>
  );
}
