import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Clock3,
  Database,
  Fingerprint,
  Mail,
  Pause,
  Play,
  ScanFace,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import type { PunchType } from '../types/domain';
import type { PresentationResult } from './presentationResult';

interface PresentationResultExperienceProps {
  result: PresentationResult;
  onClose: () => void;
}

const punchLabels: Record<PunchType, string> = {
  ENTRY: 'Entrada',
  LUNCH_OUT: 'Saída para intervalo',
  LUNCH_IN: 'Retorno do intervalo',
  EXIT: 'Saída',
};

function formatTime(value: Date) {
  return value.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(value: Date) {
  return value.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

export function PresentationResultExperience({ result, onClose }: PresentationResultExperienceProps) {
  const [stage, setStage] = useState<'prompt' | 'summary'>('prompt');
  const [motionPaused, setMotionPaused] = useState(false);
  const titleId = useId();
  const summaryTitleId = useId();
  const primaryActionRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const participant = result.participants[0];
  const participantCount = result.participants.length;
  const emailCount = useMemo(
    () => result.participants.filter((item) => item.emailSent).length,
    [result.participants],
  );

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    document.body.style.overflow = 'hidden';
    primaryActionRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) || []).filter((element) => !element.hasAttribute('hidden'));
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
    };
  }, [onClose]);

  useEffect(() => {
    primaryActionRef.current?.focus();
  }, [stage]);

  if (!participant) return null;

  if (stage === 'prompt') {
    return (
      <div className="presentation-result-backdrop" role="presentation">
        <section
          ref={(node) => { dialogRef.current = node; }}
          className="presentation-result-prompt"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
        >
          <div className="presentation-result-stamp" aria-hidden="true">
            <Check size={28} strokeWidth={2.4} />
          </div>
          <span className="presentation-result-kicker">Experiência concluída</span>
          <h2 id={titleId}>
            {participantCount > 1
              ? `${participantCount} participantes foram registrados.`
              : `${participant.name}, seu ponto foi registrado.`}
          </h2>
          <p>
            Quer ver, em menos de um minuto, o caminho que esse registro percorreu e como o projeto foi construído?
          </p>
          <dl className="presentation-result-receipt">
            <div><dt>Movimento</dt><dd>{participant.punchType ? punchLabels[participant.punchType] : 'Ponto'}</dd></div>
            <div><dt>Horário</dt><dd><time dateTime={participant.occurredAt.toISOString()}>{formatTime(participant.occurredAt)}</time></dd></div>
            <div><dt>Local</dt><dd>{result.worksiteName}</dd></div>
          </dl>
          <div className="presentation-result-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Agora não</button>
            <button
              ref={primaryActionRef}
              type="button"
              className="btn presentation-result-primary"
              onClick={() => setStage('summary')}
            >
              Ver meu resumo <ArrowRight size={17} />
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div
      ref={(node) => { dialogRef.current = node; }}
      className="presentation-story"
      data-motion-paused={motionPaused || undefined}
      role="dialog"
      aria-modal="true"
      aria-labelledby={summaryTitleId}
    >
      <header className="presentation-story-nav">
        <div className="presentation-story-brand">
          <span aria-hidden="true">CE</span>
          <div><strong>Curitiba Empreiteira</strong><small>Projeto de ponto facial</small></div>
        </div>
        <div className="presentation-story-nav-actions">
          <button
            type="button"
            onClick={() => setMotionPaused((current) => !current)}
            aria-pressed={motionPaused}
          >
            {motionPaused ? <Play size={16} /> : <Pause size={16} />}
            {motionPaused ? 'Continuar movimento' : 'Pausar movimento'}
          </button>
          <button ref={primaryActionRef} type="button" onClick={onClose}>
            <ArrowLeft size={17} /> Voltar ao terminal
          </button>
        </div>
      </header>

      <main>
        <section className="presentation-story-hero">
          <div className="presentation-story-hero-copy">
            <span className="presentation-story-index">00 / REGISTRO CONFIRMADO</span>
            <h2 id={summaryTitleId}>
              Você acabou de atravessar um sistema inteiro <em>em segundos.</em>
            </h2>
            <p>
              {participantCount > 1
                ? `${participantCount} pessoas foram reconhecidas na mesma leitura e transformadas em registros individuais, auditáveis e vinculados à obra.`
                : `${participant.name} olhou para uma câmera. Por trás desse gesto simples, visão computacional, regras de jornada, banco de dados e notificação trabalharam juntos.`}
            </p>
            <div className="presentation-story-proof">
              <span><Check size={16} /> {participantCount} {participantCount === 1 ? 'registro aceito' : 'registros aceitos'}</span>
              <span><Clock3 size={16} /> <time dateTime={participant.occurredAt.toISOString()}>{formatTime(participant.occurredAt)}</time></span>
              <span><Building2 size={16} /> {result.worksiteCode ? `${result.worksiteCode} · ` : ''}{result.worksiteName}</span>
            </div>
            {participantCount > 1 && (
              <ol className="presentation-story-participants" aria-label="Participantes confirmados nesta leitura">
                {result.participants.map((item, index) => (
                  <li key={item.id}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <div>
                      <strong>{item.name}</strong>
                      <small>{item.registration || 'Participante da feira'}</small>
                    </div>
                    <div>
                      <strong>{item.punchType ? punchLabels[item.punchType] : 'Ponto'}</strong>
                      <small>
                        <time dateTime={item.occurredAt.toISOString()}>{formatTime(item.occurredAt)}</time>
                        {' · '}{item.emailSent ? 'E-mail enviado' : 'Registro confirmado'}
                      </small>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            <a href="#como-funciona" className="presentation-story-scroll">
              Explorar o projeto <ArrowDown size={17} />
            </a>
          </div>

          <div className="presentation-data-sculpture" aria-hidden="true">
            <div className="presentation-sculpture-grid" />
            <div className="presentation-sculpture-ring ring-one" />
            <div className="presentation-sculpture-ring ring-two" />
            <div className="presentation-sculpture-ring ring-three" />
            <div className="presentation-sculpture-core">
              <span className="core-face"><ScanFace size={42} /></span>
              <span className="core-plane plane-front" />
              <span className="core-plane plane-back" />
              <span className="core-plane plane-left" />
              <span className="core-plane plane-right" />
            </div>
            <span className="presentation-orbit-label orbit-capture">CAPTURA</span>
            <span className="presentation-orbit-label orbit-match">MATCH</span>
            <span className="presentation-orbit-label orbit-record">REGISTRO</span>
            <span className="presentation-sculpture-coordinate coordinate-x">X 25°26′</span>
            <span className="presentation-sculpture-coordinate coordinate-y">Y 49°16′</span>
          </div>
        </section>

        <section id="como-funciona" className="presentation-story-section presentation-story-journey">
          <header className="presentation-story-section-heading">
            <span className="presentation-story-index">01 / O CAMINHO</span>
            <h3>Quatro sistemas. Uma única ação.</h3>
            <p>Cada etapa só avança quando a anterior entrega uma evidência utilizável.</p>
          </header>
          <ol>
            <li>
              <span>01</span><ScanFace size={24} />
              <div><strong>O navegador encontra o rosto</strong><p>A câmera continua ao vivo enquanto um recorte interno preserva o instante mais útil para análise.</p></div>
            </li>
            <li>
              <span>02</span><Fingerprint size={24} />
              <div><strong>A IA compara identidades</strong><p>O backend facial separa cada pessoa, gera características numéricas e procura uma correspondência compatível.</p></div>
            </li>
            <li>
              <span>03</span><Database size={24} />
              <div><strong>A regra de jornada decide</strong><p>Entrada, intervalo, retorno ou saída são definidos pelo histórico e salvos como registros individuais.</p></div>
            </li>
            <li>
              <span>04</span><Mail size={24} />
              <div><strong>A confirmação chega</strong><p>{emailCount ? `${emailCount} ${emailCount === 1 ? 'e-mail foi confirmado' : 'e-mails foram confirmados'} nesta leitura.` : 'Quando o envio está disponível, o participante recebe a confirmação após o registro ser salvo.'}</p></div>
            </li>
          </ol>
        </section>

        <section className="presentation-story-section presentation-story-blueprint">
          <div className="presentation-blueprint-copy">
            <span className="presentation-story-index">02 / A ARQUITETURA</span>
            <h3>Construído como uma obra: cada camada sustenta a próxima.</h3>
            <p>O projeto separa a interface, as regras operacionais e a inteligência facial. Assim, a câmera permanece rápida enquanto o processamento pesado acontece em um serviço próprio.</p>
            <dl>
              <div><dt>Interface</dt><dd>React + TypeScript</dd></div>
              <div><dt>Operação</dt><dd>FastAPI + PostgreSQL</dd></div>
              <div><dt>Reconhecimento</dt><dd>InsightFace + ONNX</dd></div>
              <div><dt>Confirmação</dt><dd>SMTP transacional</dd></div>
            </dl>
          </div>
          <div className="presentation-blueprint-stack" role="img" aria-label="Arquitetura em quatro camadas">
            <div><span>04</span><Mail size={21} /><strong>Mensagem</strong><small>e-mail confirmado</small></div>
            <div><span>03</span><Database size={21} /><strong>Registro</strong><small>histórico auditável</small></div>
            <div><span>02</span><Fingerprint size={21} /><strong>Identidade</strong><small>comparação facial</small></div>
            <div><span>01</span><ScanFace size={21} /><strong>Imagem</strong><small>captura no navegador</small></div>
          </div>
        </section>

        <section className="presentation-story-section presentation-story-impact">
          <header className="presentation-story-section-heading">
            <span className="presentation-story-index">03 / POR QUE EXISTE</span>
            <h3>Menos fila na portaria. Mais clareza depois.</h3>
          </header>
          <div className="presentation-impact-line">
            <article><strong>Sem toque</strong><p>O movimento é registrado olhando para a câmera, inclusive para mais de uma pessoa na mesma leitura.</p></article>
            <article><strong>Rastreável</strong><p>Horário, pessoa e obra seguem juntos para relatórios e auditoria operacional.</p></article>
            <article><strong>Com retorno</strong><p>O e-mail transforma uma decisão invisível do sistema em confirmação para o participante.</p></article>
          </div>
        </section>

        <section className="presentation-story-section presentation-story-trust">
          <div className="presentation-trust-symbol" aria-hidden="true"><ShieldCheck size={42} /></div>
          <div>
            <span className="presentation-story-index">04 / RESPONSABILIDADE</span>
            <h3>Biometria é dado sensível. O projeto trata isso como requisito, não detalhe.</h3>
            <p>O cadastro facial usa representações numéricas chamadas embeddings. O acesso respeita perfis, as ações críticas podem ser auditadas e a implantação precisa definir consentimento, finalidade, retenção e exclusão conforme a LGPD.</p>
          </div>
        </section>

        <section className="presentation-story-final">
          <Sparkles size={24} aria-hidden="true" />
          <span>Seu registro foi a demonstração.</span>
          <h3>O projeto é tudo o que aconteceu sem você precisar pensar.</h3>
          <p><time dateTime={participant.occurredAt.toISOString()}>{formatDate(participant.occurredAt)} · {formatTime(participant.occurredAt)}</time> · {result.worksiteName}</p>
          <button type="button" onClick={onClose} className="presentation-story-final-action">
            Voltar e registrar outra pessoa <ArrowRight size={18} />
          </button>
        </section>
      </main>

      <button type="button" className="presentation-story-close" onClick={onClose} aria-label="Fechar resumo">
        <X size={19} />
      </button>
    </div>
  );
}
