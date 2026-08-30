import { AlertCircle, LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  PresentationResultSummary,
} from '../presentation/PresentationResultExperience';
import type { PresentationResult } from '../presentation/presentationResult';
import { receivePresentationResult } from '../presentation/presentationResultTransfer';

const RESULT_WAIT_TIMEOUT_MS = 45_000;

function createDevelopmentPreview(): PresentationResult | null {
  if (!import.meta.env.DEV || new URLSearchParams(window.location.search).get('preview') !== '1') return null;
  return {
    worksiteName: 'Feira de Tecnologia · Colégio Maluf',
    worksiteCode: 'FEIRA-2026',
    participants: [{
      id: 'preview-participant',
      name: 'Participante da feira',
      registration: 'Demonstração local',
      punchType: 'ENTRY',
      occurredAt: new Date(),
      emailSent: true,
    }],
  };
}

export function PresentationResultPage() {
  const [result, setResult] = useState<PresentationResult | null>(createDevelopmentPreview);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const sessionId = new URLSearchParams(window.location.search).get('session') || '';
    const stopReceiving = receivePresentationResult(sessionId, setResult);
    const timer = window.setTimeout(() => setExpired(true), RESULT_WAIT_TIMEOUT_MS);
    document.title = 'Resumo da experiência | Curitiba Empreiteira';
    return () => {
      stopReceiving();
      window.clearTimeout(timer);
    };
  }, []);

  const closePage = () => {
    window.close();
    window.setTimeout(() => {
      if (!window.closed) window.location.assign('/terminal-facial');
    }, 120);
  };

  if (result) return <PresentationResultSummary result={result} onClose={closePage} />;

  return (
    <main className="presentation-result-page-state">
      {expired ? <AlertCircle size={28} /> : <LoaderCircle className="is-spinning" size={28} />}
      <h1>{expired ? 'Este resumo não está mais disponível.' : 'Preparando o resumo da experiência'}</h1>
      <p>
        {expired
          ? 'Volte ao terminal e conclua um novo registro para gerar outra apresentação.'
          : 'Transferindo os dados confirmados sem armazená-los nesta página.'}
      </p>
      {expired && <button type="button" onClick={closePage}>Voltar ao terminal</button>}
    </main>
  );
}
