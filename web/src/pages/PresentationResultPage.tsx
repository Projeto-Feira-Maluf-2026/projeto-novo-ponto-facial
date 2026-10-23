import { AlertCircle } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  PresentationResultSummary,
} from '../presentation/PresentationResultExperience';
import type { PresentationResult } from '../presentation/presentationResult';
import { consumeQueuedPresentationResult } from '../presentation/presentationResultTransfer';

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
  const [result] = useState<PresentationResult | null>(() => (
    consumeQueuedPresentationResult() || createDevelopmentPreview()
  ));
  useEffect(() => {
    document.title = 'Resumo da experiência | Curitiba Empreiteira';
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
      <AlertCircle size={28} />
      <h1>Este resumo não está mais disponível.</h1>
      <p>Volte ao terminal e conclua um novo registro para gerar outra apresentação.</p>
      <button type="button" onClick={closePage}>Voltar ao terminal</button>
    </main>
  );
}
