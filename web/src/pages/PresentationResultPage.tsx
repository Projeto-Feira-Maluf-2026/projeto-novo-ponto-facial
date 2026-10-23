import { AlertCircle } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import type { PresentationResult } from '../presentation/presentationResult';

const PresentationShow = lazy(() => import('../presentation/PresentationShow').then((module) => ({
  default: module.PresentationShow,
})));

/**
 * Prévia isolada da apresentação. No uso real, ela abre por cima do terminal
 * logo após o reconhecimento; esta rota serve para ensaiar antes da feira.
 * `?preview=1` mostra uma pessoa e `?preview=grupo` mostra um grupo.
 */
function createPreview(): PresentationResult | null {
  const preview = new URLSearchParams(window.location.search).get('preview');
  if (!preview) return null;
  const now = new Date();
  const people = preview === 'grupo'
    ? ['Ana Clara Silva', 'Bruno Costa', 'Carla Mendes']
    : ['Participante da Feira'];
  return {
    worksiteName: 'Feira de Tecnologia · Colégio Maluf',
    worksiteCode: 'FEIRA-2026',
    participants: people.map((name, index) => ({
      id: `preview-${index}`,
      name,
      registration: `FEIRA-${String(index + 1).padStart(3, '0')}`,
      punchType: 'ENTRY',
      occurredAt: now,
      email: index === 1 ? 'none' : 'queued',
    })),
  };
}

export function PresentationResultPage() {
  const navigate = useNavigate();
  const result = useMemo(createPreview, []);

  useEffect(() => {
    document.title = 'Apresentação | Curitiba Empreiteira';
  }, []);

  const backToTerminal = () => navigate('/terminal-facial', { replace: true });

  if (result) {
    return (
      <Suspense fallback={null}>
        <PresentationShow result={result} onClose={backToTerminal} />
      </Suspense>
    );
  }

  return (
    <main className="presentation-result-page-state">
      <AlertCircle size={28} />
      <h1>A apresentação abre sozinha no terminal.</h1>
      <p>Com o modo apresentação ligado, basta alguém ser reconhecido pela câmera. Para ensaiar, use <code>?preview=1</code> ou <code>?preview=grupo</code>.</p>
      <button type="button" onClick={backToTerminal}>Ir para o terminal</button>
    </main>
  );
}
