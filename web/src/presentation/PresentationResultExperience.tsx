import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Clock3,
  Code2,
  Database,
  ExternalLink,
  Fingerprint,
  Lightbulb,
  Mail,
  Pause,
  Play,
  ScanFace,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

import type { PunchType } from '../types/domain';
import type { PresentationResult } from './presentationResult';
import { openPresentationResultPage } from './presentationResultTransfer';

const PresentationCinematicLayer = lazy(async () => {
  const module = await import('./PresentationCinematicLayer');
  return { default: module.PresentationCinematicLayer };
});

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

const projectTeam = [
  { name: 'Paulo Ricardo da Silva', role: 'Líder + Dev', discipline: 'DESENVOLVIMENTO' },
  { name: 'Alisson Cortati Pereira', role: 'Líder + Dev', discipline: 'DESENVOLVIMENTO' },
  { name: 'Murilo Pinheiro Cescon', role: 'Organização, ideias e cartaz', discipline: 'CRIAÇÃO' },
  { name: 'Allanis Cristina Lisboa Francisco', role: 'Organização, ideias e cartaz', discipline: 'CRIAÇÃO' },
  { name: 'Ana Clara Silva Pinheiro', role: 'Organização, ideias e cartaz', discipline: 'CRIAÇÃO' },
] as const;

interface TeamCreditsDialogProps {
  open: boolean;
  motionEnabled: boolean;
  onClose: () => void;
}

function TeamCreditsDialog({ open, motionEnabled, onClose }: TeamCreditsDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button, a[href]') || []);
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
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
      window.removeEventListener('keydown', onKeyDown);
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  return createPortal(
    <div
      className="presentation-team-backdrop"
      data-motion-enabled={motionEnabled || undefined}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={(node) => { dialogRef.current = node; }}
        className="presentation-team-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="presentation-team-dialog-heading">
          <div>
            <span>CRÉDITOS DO PROJETO · 2026</span>
            <h2 id={titleId}>Cinco pessoas.<br />Uma construção coletiva.</h2>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Fechar créditos da equipe">
            <X size={22} />
          </button>
        </header>
        <ol className="presentation-team-roster">
          {projectTeam.map((member, index) => (
            <li
              key={member.name}
              style={{ '--team-order': index, '--team-x': index % 2 ? '12vw' : '-12vw' } as CSSProperties}
            >
              <span>{String(index + 1).padStart(2, '0')}</span>
              <div className="presentation-team-monogram" aria-hidden="true">
                {member.name.split(' ').slice(0, 2).map((part) => part[0]).join('')}
              </div>
              <div>
                <small>{member.discipline}</small>
                <strong>{member.name}</strong>
              </div>
              <p>{member.role}</p>
            </li>
          ))}
        </ol>
        <footer>
          <span>Colégio Estadual Alfredo Moisés Maluf</span>
          <strong>Feira de Tecnologia</strong>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function formatTime(value: Date) {
  return value.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(value: Date) {
  return value.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

export function PresentationResultExperience({ result, onClose }: PresentationResultExperienceProps) {
  const [openError, setOpenError] = useState(false);
  const titleId = useId();
  const primaryActionRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const participant = result.participants[0];
  const participantCount = result.participants.length;

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

  if (!participant) return null;

  const openSummary = () => {
    setOpenError(false);
    if (openPresentationResultPage(result)) {
      onClose();
      return;
    }
    setOpenError(true);
  };

  return createPortal(
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
            Quer abrir uma página separada e ver, em menos de um minuto, o caminho que esse registro percorreu?
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
              onClick={openSummary}
            >
              Abrir meu resumo <ExternalLink size={17} />
            </button>
          </div>
          {openError && (
            <p className="presentation-result-open-error" role="alert">
              O navegador bloqueou a nova página. Permita pop-ups para este site e tente novamente.
            </p>
          )}
        </section>
      </div>,
    document.body,
  );
}

export function PresentationResultSummary({ result, onClose }: PresentationResultExperienceProps) {
  const systemPrefersReducedMotion = useMemo(
    () => typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );
  const [motionPaused, setMotionPaused] = useState(systemPrefersReducedMotion);
  const [motionOverride, setMotionOverride] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const storyRef = useRef<HTMLDivElement | null>(null);
  const summaryTitleId = useId();
  const participant = result.participants[0];
  const participantCount = result.participants.length;
  const emailCount = useMemo(
    () => result.participants.filter((item) => item.emailSent).length,
    [result.participants],
  );
  if (!participant) return null;

  return (
    <div
      ref={storyRef}
      className="presentation-story"
      data-motion-paused={motionPaused || undefined}
      data-motion-override={motionOverride || undefined}
      aria-labelledby={summaryTitleId}
    >
      <Suspense fallback={null}>
        <PresentationCinematicLayer
          rootRef={storyRef}
          paused={motionPaused}
          allowReducedMotion={motionOverride}
        />
      </Suspense>
      <header className="presentation-story-nav">
        <div className="presentation-story-brand">
          <span aria-hidden="true">CE</span>
          <div><strong>Curitiba Empreiteira</strong><small>Feira de Tecnologia · Colégio Maluf</small></div>
        </div>
        <div className="presentation-story-nav-actions">
          <button type="button" onClick={() => setTeamOpen(true)}>
            <Users size={16} /> Equipe
          </button>
          <button
            type="button"
            onClick={() => {
              if (systemPrefersReducedMotion && !motionOverride) {
                setMotionOverride(true);
                setMotionPaused(false);
                return;
              }
              setMotionPaused((current) => !current);
            }}
            aria-pressed={motionPaused}
          >
            {motionPaused ? <Play size={16} /> : <Pause size={16} />}
            {systemPrefersReducedMotion && !motionOverride
              ? 'Ativar experiência completa'
              : motionPaused ? 'Continuar movimento' : 'Pausar movimento'}
          </button>
          <button type="button" onClick={onClose}>
            <ArrowLeft size={17} /> Fechar resumo
          </button>
        </div>
      </header>

      <aside className="presentation-chapter-rail" aria-label="Navegação pelos capítulos">
        <span className="presentation-chapter-progress" aria-hidden="true"><i /></span>
        <a href="#registro"><span>00</span><b>Registro</b></a>
        <a href="#como-funciona"><span>01</span><b>Caminho</b></a>
        <a href="#arquitetura"><span>02</span><b>Arquitetura</b></a>
        <a href="#impacto"><span>03</span><b>Impacto</b></a>
        <a href="#responsabilidade"><span>04</span><b>Proteção</b></a>
        <a href="#maluf"><span>05</span><b>Maluf</b></a>
        <a href="#equipe"><span>06</span><b>Equipe</b></a>
      </aside>

      <main>
        <section id="registro" className="presentation-story-hero">
          <div className="presentation-story-hero-copy" data-story-hero-copy>
            <span className="presentation-story-index">00 / REGISTRO CONFIRMADO</span>
            <h2 id={summaryTitleId} aria-label="Você acabou de atravessar um sistema inteiro em segundos.">
              <span className="presentation-story-word-line"><span data-story-hero-word>Você acabou de</span></span>
              <span className="presentation-story-word-line"><span data-story-hero-word>atravessar um sistema</span></span>
              <span className="presentation-story-word-line"><em data-story-hero-word>inteiro em segundos.</em></span>
            </h2>
            <p data-story-intro>
              {participantCount > 1
                ? `${participantCount} pessoas foram reconhecidas na mesma leitura e transformadas em registros individuais, auditáveis e vinculados à obra.`
                : `${participant.name} olhou para uma câmera. Por trás desse gesto simples, visão computacional, regras de jornada, banco de dados e notificação trabalharam juntos.`}
            </p>
            <div className="presentation-story-proof" data-story-intro>
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
            <a href="#como-funciona" className="presentation-story-scroll" data-story-intro>
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
          <div className="presentation-journey-beam" aria-hidden="true"><span /></div>
          <header className="presentation-story-section-heading" data-story-heading>
            <span className="presentation-story-index">01 / O CAMINHO</span>
            <h3>Quatro sistemas. Uma única ação.</h3>
            <p>Cada etapa só avança quando a anterior entrega uma evidência utilizável.</p>
          </header>
          <ol>
            <li data-story-step>
              <span>01</span><ScanFace size={24} />
              <div><strong>O navegador encontra o rosto</strong><p>A câmera continua ao vivo enquanto um recorte interno preserva o instante mais útil para análise.</p></div>
            </li>
            <li data-story-step>
              <span>02</span><Fingerprint size={24} />
              <div><strong>A IA compara identidades</strong><p>O backend facial separa cada pessoa, gera características numéricas e procura uma correspondência compatível.</p></div>
            </li>
            <li data-story-step>
              <span>03</span><Database size={24} />
              <div><strong>A regra de jornada decide</strong><p>Entrada, intervalo, retorno ou saída são definidos pelo histórico e salvos como registros individuais.</p></div>
            </li>
            <li data-story-step>
              <span>04</span><Mail size={24} />
              <div><strong>A confirmação chega</strong><p>{emailCount ? `${emailCount} ${emailCount === 1 ? 'e-mail foi confirmado' : 'e-mails foram confirmados'} nesta leitura.` : 'Quando o envio está disponível, o participante recebe a confirmação após o registro ser salvo.'}</p></div>
            </li>
          </ol>
        </section>

        <section id="arquitetura" className="presentation-story-section presentation-story-blueprint">
          <div className="presentation-blueprint-copy" data-story-heading>
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

        <section id="impacto" className="presentation-story-section presentation-story-impact">
          <header className="presentation-story-section-heading" data-story-heading>
            <span className="presentation-story-index">03 / POR QUE EXISTE</span>
            <h3>Menos fila na portaria. Mais clareza depois.</h3>
          </header>
          <div className="presentation-impact-line">
            <article><strong>Sem toque</strong><p>O movimento é registrado olhando para a câmera, inclusive para mais de uma pessoa na mesma leitura.</p></article>
            <article><strong>Rastreável</strong><p>Horário, pessoa e obra seguem juntos para relatórios e auditoria operacional.</p></article>
            <article><strong>Com retorno</strong><p>O e-mail transforma uma decisão invisível do sistema em confirmação para o participante.</p></article>
          </div>
        </section>

        <section id="responsabilidade" className="presentation-story-section presentation-story-trust">
          <div className="presentation-trust-symbol" aria-hidden="true"><ShieldCheck size={42} /></div>
          <div>
            <span className="presentation-story-index">04 / RESPONSABILIDADE</span>
            <h3>Biometria é dado sensível. O projeto trata isso como requisito, não detalhe.</h3>
            <p>O cadastro facial usa representações numéricas chamadas embeddings. O acesso respeita perfis, as ações críticas podem ser auditadas e a implantação precisa definir consentimento, finalidade, retenção e exclusão conforme a LGPD.</p>
          </div>
        </section>

        <section id="maluf" className="presentation-story-section presentation-story-school">
          <img
            className="presentation-school-backdrop"
            src="/maluf-school-front.jpg"
            alt="Estudantes em frente ao Colégio Estadual Alfredo Moisés Maluf, em Maringá"
            loading="lazy"
            decoding="async"
          />
          <div className="presentation-school-veil" aria-hidden="true" />
          <div className="presentation-school-heading">
            <span className="presentation-story-index">05 / A FEIRA</span>
            <h3>Tecnologia feita dentro da escola pública.</h3>
          </div>
          <div className="presentation-school-body">
            <p>
              Este projeto será apresentado na Feira de Tecnologia do Colégio Estadual Alfredo
              Moisés Maluf, em Maringá–PR. A instituição pertence à rede estadual e reúne Ensino
              Fundamental, Médio e Profissional.
            </p>
            <dl>
              <div><dt>Instituição</dt><dd>Colégio Estadual Alfredo Moisés Maluf</dd></div>
              <div><dt>Local</dt><dd>Maringá, Paraná</dd></div>
              <div><dt>Formação ligada ao projeto</dt><dd>Técnico em Desenvolvimento de Sistemas</dd></div>
            </dl>
            <div className="presentation-school-sources">
              <span>Informações verificadas em fontes públicas</span>
              <a href="https://www.consultaescolas.pr.gov.br/consultaescolas/pages/templates/initial2.xhtml?codigoEstab=603&codigoMunicipio=1530" target="_blank" rel="noreferrer">
                Consulta Escolas · Seed-PR <ExternalLink size={14} />
              </a>
              <a href="https://manna.team/2023/09/11/oficina-de-jogos-no-c-e-alfredo-moises-maluf/" target="_blank" rel="noreferrer">
                Atividade do curso técnico <ExternalLink size={14} />
              </a>
              <a href="https://youthjournalism.org/my-green-hometown-of-maringa-brazil/" target="_blank" rel="noreferrer">
                Fotografia: Nicole Luna / YJI <ExternalLink size={14} />
              </a>
            </div>
          </div>
        </section>

        <section id="equipe" className="presentation-story-section presentation-story-team-teaser">
          <div className="presentation-team-giant-number" aria-hidden="true">05</div>
          <div className="presentation-team-teaser-copy" data-story-team-copy>
            <span className="presentation-story-index">06 / QUEM CONSTRUIU</span>
            <h3>O sistema é técnico.<br />A autoria é humana.</h3>
            <p>
              Desenvolvimento, organização, pesquisa e comunicação foram construídos em conjunto
              por cinco estudantes. Conheça quem transformou a ideia em uma demonstração real.
            </p>
            <button type="button" onClick={() => setTeamOpen(true)}>
              <Users size={18} /> Abrir créditos da equipe
            </button>
          </div>
          <div className="presentation-team-disciplines" data-story-team-disciplines>
            <span><Code2 size={18} /> Desenvolvimento</span>
            <span><Lightbulb size={18} /> Ideias e organização</span>
            <span><Sparkles size={18} /> Identidade da feira</span>
          </div>
        </section>

        <section className="presentation-story-final">
          <Sparkles size={24} aria-hidden="true" />
          <span>Feira de Tecnologia · Colégio Estadual Alfredo Moisés Maluf</span>
          <h3>Seu registro transformou o projeto em uma demonstração real.</h3>
          <p><time dateTime={participant.occurredAt.toISOString()}>{formatDate(participant.occurredAt)} · {formatTime(participant.occurredAt)}</time> · {result.worksiteName}</p>
          <button type="button" onClick={onClose} className="presentation-story-final-action">
            Fechar e voltar ao terminal <ArrowRight size={18} />
          </button>
        </section>
      </main>

      <button type="button" className="presentation-story-close" onClick={onClose} aria-label="Fechar resumo">
        <X size={19} />
      </button>
      <TeamCreditsDialog
        open={teamOpen}
        motionEnabled={motionOverride || !systemPrefersReducedMotion}
        onClose={() => setTeamOpen(false)}
      />
    </div>
  );
}
