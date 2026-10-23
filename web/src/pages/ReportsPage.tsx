import {
  AlertCircle,
  CalendarRange,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  LoaderCircle,
  ScrollText,
  Table2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { userHasRole } from '../auth/permissions';
import { apiClient, type ReportExportPayload } from '../services/api';
import type { Employee, Worksite } from '../types/domain';
import { AuditLogPanel } from './AuditPage';

type ReportKind = ReportExportPayload['kind'];
type ReportFormat = ReportExportPayload['format'];

const kindOptions: Array<{ value: ReportKind; label: string }> = [
  { value: 'daily', label: 'Diário' },
  { value: 'weekly', label: 'Semanal' },
  { value: 'monthly', label: 'Mensal' },
  { value: 'employee', label: 'Por funcionário' },
  { value: 'worksite', label: 'Por obra' },
  { value: 'custom', label: 'Período personalizado' },
];

const formatOptions = [
  { key: 'pdf' as const, label: 'PDF', description: 'Documento pronto para auditoria', icon: FileText },
  { key: 'xlsx' as const, label: 'Excel', description: 'Planilha para fechamento de folha', icon: FileSpreadsheet },
  { key: 'csv' as const, label: 'CSV', description: 'Dados simples para integração', icon: Table2 },
];

function toDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function presetRange(kind: ReportKind) {
  const end = new Date();
  const start = new Date(end);
  if (kind === 'weekly') start.setDate(end.getDate() - 6);
  if (kind !== 'daily' && kind !== 'weekly') start.setDate(1);
  return { start: toDateInput(start), end: toDateInput(end) };
}

function apiDate(date: string, endOfDay = false) {
  return new Date(`${date}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`).toISOString();
}

function ReportExportPanel() {
  const initialRange = presetRange('monthly');
  const [kind, setKind] = useState<ReportKind>('monthly');
  const [format, setFormat] = useState<ReportFormat>('pdf');
  const [startsAt, setStartsAt] = useState(initialRange.start);
  const [endsAt, setEndsAt] = useState(initialRange.end);
  const [employeeId, setEmployeeId] = useState('');
  const [worksiteId, setWorksiteId] = useState('');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [worksites, setWorksites] = useState<Worksite[]>([]);
  const [exporting, setExporting] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    Promise.all([apiClient.employees(), apiClient.worksites()])
      .then(([employeePage, worksitePage]) => {
        setEmployees(employeePage.items);
        setWorksites(worksitePage.items);
      })
      .catch(() => setFeedback({
        tone: 'error',
        text: 'Os filtros de funcionário e obra não puderam ser carregados.',
      }));
  }, []);

  const validationMessage = useMemo(() => {
    if (!startsAt || !endsAt) return 'Informe o início e o fim do período.';
    if (startsAt > endsAt) return 'A data inicial não pode ser posterior à data final.';
    if (kind === 'employee' && !employeeId) return 'Selecione o funcionário deste relatório.';
    if (kind === 'worksite' && !worksiteId) return 'Selecione a obra deste relatório.';
    return '';
  }, [employeeId, endsAt, kind, startsAt, worksiteId]);

  const changeKind = (nextKind: ReportKind) => {
    setKind(nextKind);
    setFeedback(null);
    if (nextKind === 'daily' || nextKind === 'weekly' || nextKind === 'monthly') {
      const range = presetRange(nextKind);
      setStartsAt(range.start);
      setEndsAt(range.end);
    }
  };

  const exportReport = async () => {
    if (validationMessage) {
      setFeedback({ tone: 'error', text: validationMessage });
      return;
    }
    setExporting(true);
    setFeedback(null);
    try {
      const result = await apiClient.exportReport({
        kind,
        format,
        starts_at: apiDate(startsAt),
        ends_at: apiDate(endsAt, true),
        employee_id: kind === 'employee' ? employeeId : null,
        worksite_id: kind === 'worksite' ? worksiteId : null,
      });
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setFeedback({ tone: 'success', text: `Relatório ${result.filename} gerado com sucesso.` });
    } catch {
      setFeedback({ tone: 'error', text: 'Não foi possível gerar o relatório. Confira o período e tente novamente.' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="app-view-transition reports-workspace">
      <section className="report-filter-panel" aria-labelledby="report-filter-heading">
        <header className="report-section-heading">
          <span className="report-section-index">01</span>
          <div>
            <h2 id="report-filter-heading">Defina o recorte</h2>
            <p>Escolha o período e limite os registros quando precisar de um funcionário ou obra.</p>
          </div>
        </header>
        <div className="report-filter-grid">
          <label className="field-label">
            <span>Tipo de relatório</span>
            <select value={kind} onChange={(event) => changeKind(event.target.value as ReportKind)} className="input-field">
              {kindOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="field-label"><span>Início</span><input value={startsAt} onChange={(event) => setStartsAt(event.target.value)} type="date" className="input-field" /></label>
          <label className="field-label"><span>Fim</span><input value={endsAt} onChange={(event) => setEndsAt(event.target.value)} type="date" className="input-field" /></label>
          {kind === 'employee' && (
            <label className="field-label">
              <span>Funcionário</span>
              <select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} className="input-field" required>
                <option value="">Selecione</option>
                {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.registration} · {employee.name}</option>)}
              </select>
            </label>
          )}
          {kind === 'worksite' && (
            <label className="field-label">
              <span>Obra</span>
              <select value={worksiteId} onChange={(event) => setWorksiteId(event.target.value)} className="input-field" required>
                <option value="">Selecione</option>
                {worksites.map((worksite) => <option key={worksite.id} value={worksite.id}>{worksite.code} · {worksite.name}</option>)}
              </select>
            </label>
          )}
        </div>
      </section>

      <fieldset className="report-format-panel">
        <legend className="sr-only">Formato do arquivo</legend>
        <header className="report-section-heading">
          <span className="report-section-index">02</span>
          <div><h2>Escolha o arquivo</h2><p>O conteúdo é o mesmo; escolha o formato adequado ao próximo uso.</p></div>
        </header>
        <div className="report-format-list">
          {formatOptions.map(({ key, label, description, icon: Icon }) => (
            <label key={key} className="report-format-option" data-active={format === key}>
              <input type="radio" name="report-format" value={key} checked={format === key} onChange={() => setFormat(key)} />
              <span className="report-format-icon"><Icon size={20} /></span>
              <span><strong>{label}</strong><small>{description}</small></span>
              <span className="report-format-radio" aria-hidden="true" />
            </label>
          ))}
        </div>
      </fieldset>

      <section className="report-export-bar" aria-label="Gerar relatório">
        <div className="report-export-summary">
          <CalendarRange size={19} aria-hidden="true" />
          <span><strong>{kindOptions.find((option) => option.value === kind)?.label}</strong><small>{startsAt.split('-').reverse().join('/')} até {endsAt.split('-').reverse().join('/')}</small></span>
        </div>
        <button type="button" onClick={() => void exportReport()} disabled={exporting} className="btn btn-primary">
          {exporting ? <LoaderCircle size={18} className="animate-spin" /> : <Download size={18} />}
          {exporting ? 'Gerando arquivo' : `Exportar ${format.toUpperCase()}`}
        </button>
      </section>

      {feedback && (
        <div className={`feedback-banner report-feedback is-${feedback.tone}`} role={feedback.tone === 'error' ? 'alert' : 'status'}>
          {feedback.tone === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
          <span>{feedback.text}</span>
        </div>
      )}
    </div>
  );
}

export function ReportsPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const canViewAudit = userHasRole(user, ['SUPER_ADMIN', 'RH']);
  const requestedView = searchParams.get('view');
  const activeView = requestedView === 'audit' && canViewAudit ? 'audit' : 'export';

  const selectView = (view: 'export' | 'audit') => {
    const next = new URLSearchParams(searchParams);
    if (view === 'export') next.delete('view');
    else next.set('view', view);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="app-view-transition reports-hub">
      {canViewAudit && (
        <nav className="reports-section-nav" aria-label="Seções de relatórios">
          <button type="button" data-active={activeView === 'export'} aria-current={activeView === 'export' ? 'page' : undefined} onClick={() => selectView('export')}>
            <FileText size={17} /> Exportar relatórios
          </button>
          <button type="button" data-active={activeView === 'audit'} aria-current={activeView === 'audit' ? 'page' : undefined} onClick={() => selectView('audit')}>
            <ScrollText size={17} /> Auditoria
          </button>
        </nav>
      )}
      {activeView === 'audit' ? <AuditLogPanel /> : <ReportExportPanel />}
    </div>
  );
}
