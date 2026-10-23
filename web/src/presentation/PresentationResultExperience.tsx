import { ArrowDown, ArrowLeft, ArrowRight, Check, Database, ExternalLink, Fingerprint, Mail, ScanFace, ShieldCheck } from 'lucide-react';
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { PunchType } from '../types/domain';
import { formatInAppTimeZone } from '../utils/dateTime';
import type { PresentationResult } from './presentationResult';
import { queuePresentationResultForNavigation } from './presentationResultTransfer';
import { projectTeam } from './presentationTeam';
import { AttendanceSequence } from './AttendanceSequence';
import { ArchitectureCard } from './ArchitectureCard';
import './presentation-film.css';

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

function formatTime(value: Date) {
  return formatInAppTimeZone(value, { hour: '2-digit', minute: '2-digit' });
}

function formatDate(value: Date) {
  return formatInAppTimeZone(value, { day: '2-digit', month: 'long', year: 'numeric' });
}

function MotionWords({ text }: { text: string }) {
  return <>{text.split(' ').map((word, index) => <span className="film-word-mask" key={`${word}-${index}`}><span data-film-word>{word}</span>{' '}</span>)}</>;
}

export function PresentationResultExperience({ result, onClose }: PresentationResultExperienceProps) {
  const navigate = useNavigate();
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current || !result.participants.length) return;
    startedRef.current = true;
    queuePresentationResultForNavigation(result);
    navigate('/apresentacao/resumo');
    onClose();
  }, [navigate, onClose, result]);

  return null;
}

export function PresentationResultSummary({ result, onClose }: PresentationResultExperienceProps) {
  const storyRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const participant = result.participants[0];
  const count = result.participants.length;
  const emailCount = useMemo(() => result.participants.filter((item) => item.emailSent).length, [result.participants]);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(onClose, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 420);
    return () => window.clearTimeout(timer);
  }, [leaving, onClose]);
  const close = () => setLeaving(true);
  if (!participant) return null;
  const stages = [
    { title: 'Um rosto entra no quadro.', label: 'Imagem', text: 'A câmera continua ao vivo. O navegador encontra o rosto e separa um recorte interno para análise.', icon: ScanFace },
    { title: 'A imagem vira características.', label: 'Identidade', text: 'A IA compara características numéricas com os cadastros autorizados. A leitura só avança se atender aos critérios de reconhecimento.', icon: Fingerprint },
    { title: 'A presença encontra sua jornada.', label: 'Registro', text: 'Pessoa, horário e obra seguem juntos. O histórico define a etapa da jornada; cada pessoa recebe seu próprio registro.', icon: Database },
    { title: 'O registro deixa uma evidência.', label: 'Retorno', text: emailCount ? `${emailCount} ${emailCount === 1 ? 'envio de e-mail foi confirmado' : 'envios de e-mail foram confirmados'} nesta leitura. A confirmação vem depois do registro; não substitui o histórico.` : 'O registro foi confirmado. O envio de e-mail não foi confirmado nesta leitura; o histórico continua sendo a evidência da operação.', icon: Mail },
  ];
  return (
    <div ref={storyRef} className="presentation-story film" data-theme="curitiba-film" data-motion-preview={import.meta.env.DEV && new URLSearchParams(window.location.search).get('motion') === 'full' ? 'full' : undefined} data-leaving={leaving || undefined} aria-labelledby={titleId}>
      <div className="film-curtain" aria-hidden="true"><span>Curitiba Empreiteira</span><small>Construção e tecnologia</small></div>
      <Suspense fallback={null}><PresentationCinematicLayer rootRef={storyRef} /></Suspense>
      <a className="film-skip" href="#como-funciona">Pular para a explicação</a>
      <header className="film-nav">
        <a href="#registro" className="film-brand" aria-label="Curitiba Empreiteira, início da apresentação">
          <img src="/curitiba-mark.svg" alt="" width="40" height="40" />
          <span>Curitiba Empreiteira<small>Presença que constrói.</small></span>
        </a>
        <span className="film-nav-context">Feira de tecnologia · Maluf</span>
        <button className="film-btn film-btn-ghost" onClick={close} disabled={leaving} type="button"><ArrowLeft size={16} /><span>Voltar ao terminal</span></button>
        <div className="film-reading-progress" aria-hidden="true" />
      </header>
      <main>
        <section id="registro" className="film-hero">
          <div className="presentation-story-hero-copy film-hero-copy" data-film-hero>
            <span className="film-eyebrow"><span className="film-status-dot" /> Registro confirmado · {formatTime(participant.occurredAt)}</span>
            <h1 id={titleId}><span className="film-line-mask"><span data-film-line>Uma presença.</span></span><span className="film-line-mask"><span data-film-line>Uma obra inteira</span></span><span className="film-line-mask"><em data-film-line>em movimento.</em></span></h1>
            <p>{count === 1 ? `${participant.name}, seu registro é o ponto de partida desta história.` : `${count} pessoas reconhecidas, ${count} registros individuais. Esta história começa com vocês.`} Veja o que acontece entre olhar para a câmera e confirmar a presença.</p>
            <dl className="film-proof">
              <div><dt>Obra</dt><dd>{result.worksiteName}</dd></div>
              <div><dt>Registro</dt><dd>{participant.punchType ? punchLabels[participant.punchType] : 'Ponto confirmado'}</dd></div>
            </dl>
            <a href="#como-funciona" className="film-scroll-cue"><span>Percorra o projeto</span><ArrowDown size={18} /></a>
          </div>
          <div className="film-hero-footnote"><span>Construção civil × visão computacional</span><span>Uma demonstração real.</span></div>
        </section>

        <section id="como-funciona" className="film-journey">
          <header className="film-section-heading" data-film-reveal>
            <span className="film-eyebrow">01 / O caminho</span>
            <h2>Um gesto simples.<br />Quatro etapas conectadas.</h2>
            <p>Role devagar. A imagem acompanha cada etapa até se tornar um registro.</p>
          </header>
          <div className="film-journey-layout">
            <div className="film-journey-text">
              {stages.map((stage, index) => <article key={stage.label} className="film-stage" data-film-stage={index}>
                <div className="film-stage-number"><span>{String(index + 1).padStart(2, '0')}</span><stage.icon size={24} /></div>
                <span className="film-eyebrow">{stage.label}</span><h3>{stage.title}</h3><p>{stage.text}</p>
              </article>)}
            </div>
            <div className="film-journey-visual" data-sequence-stage="0"><AttendanceSequence /></div>
          </div>
        </section>

        <section id="arquitetura" className="film-architecture">
          <div className="film-section-heading" data-film-reveal>
            <span className="film-eyebrow">02 / A estrutura</span>
            <h2>Como uma obra,<br />cada camada<br /><em>tem seu trabalho.</em></h2>
            <p>A interface cuida da experiência. O serviço facial analisa a imagem. As regras da aplicação decidem como registrar. O banco mantém o histórico.</p>
          </div>
          <div className="film-architecture-scene"><ol className="film-structural-stack" aria-label="Camadas da arquitetura">
            {[
              ['Interface', 'React + TypeScript', 'Câmera, enquadramento e retorno.'],
              ['Inteligência facial', 'InsightFace + ONNX', 'Características e comparação de rostos.'],
              ['Operação', 'FastAPI', 'Regras da jornada e vínculo com a obra.'],
              ['Histórico', 'PostgreSQL', 'Registros consultáveis e auditáveis.'],
            ].map(([title, tech, description], index) => <li key={title} data-film-slab><ArchitectureCard title={title} tech={tech} description={description} index={index} /></li>)}
          </ol><div className="film-deck-controls" role="group" aria-label="Explorar camadas da arquitetura">
            {['Interface','Inteligência facial','Operação','Histórico'].map((label,index)=><button key={label} type="button" data-deck-control={index} aria-label={`Mostrar camada: ${label}`} aria-pressed={index===0} onClick={()=>{
              const root=storyRef.current, chapter=root?.querySelector<HTMLElement>('#arquitetura');
              if (!root || !chapter) return;
              const top=chapter.getBoundingClientRect().top-root.getBoundingClientRect().top+root.scrollTop;
              const card=chapter.querySelectorAll<HTMLElement>('[data-film-slab]')[index];
              const destination=window.matchMedia('(min-width: 901px)').matches ? top+(chapter.offsetHeight-root.clientHeight)*(index+.4)/4 : (card?.getBoundingClientRect().top ?? 0)-root.getBoundingClientRect().top+root.scrollTop-120;
              if (root.dataset.motionEngine==='gsap') root.dispatchEvent(new CustomEvent('film:navigate',{detail:destination}));
              else chapter.querySelectorAll<HTMLElement>('[data-film-slab]')[index]?.scrollIntoView({block:'center',behavior:'instant'});
            }}><span aria-hidden="true" /></button>)}
          </div></div>
        </section>

        <section id="impacto" className="film-impact"><div className="film-impact-scene">
          <div className="film-section-heading" data-film-reveal><span className="film-eyebrow">03 / No dia a dia</span><h2><MotionWords text="A presença passa." /><br /><em><MotionWords text="A informação fica." /></em></h2></div>
          <div className="film-impact-ledger">
            {[
              ['Na portaria', 'Olhar. Registrar. Seguir.', 'A proposta é tornar o registro simples, sem exigir toque na tela.'],
              ['Na gestão', 'Pessoa, horário e obra.', 'O histórico organiza a presença e ajuda a conferir a jornada.'],
              ['Para o participante', 'Uma confirmação clara.', 'O retorno mostra se a operação foi aceita; o e-mail informa o envio quando disponível.'],
            ].map(([label, title, text]) => <article key={label} data-film-reveal><span className="film-eyebrow">{label}</span><h3>{title}</h3><p>{text}</p></article>)}
          </div></div>
        </section>

        <section id="responsabilidade" className="film-responsibility">
          <header data-film-reveal><span className="film-eyebrow">04 / Os limites também fazem parte</span><h2>Reconhecer alguém<br />é uma responsabilidade.</h2></header>
          <div className="film-responsibility-body" data-film-reveal>
            <ShieldCheck size={36} aria-hidden="true" />
            <p>Biometria é um dado pessoal sensível. Consentimento, finalidade, acesso, retenção e exclusão precisam fazer parte da implantação.</p>
            <dl><div><dt>Condições reais</dt><dd>Luz, distância, enquadramento e a qualidade da webcam influenciam a leitura.</dd></div><div><dt>Reconhecimento não é prova de vida</dt><dd>Detectar uma face não comprova que uma pessoa está fisicamente diante da câmera. Essa proteção precisa de validação própria.</dd></div><div><dt>Demonstração ≠ homologação</dt><dd>Uma apresentação bem-sucedida não mede a taxa de erro nem comprova segurança para todos os ambientes.</dd></div></dl>
          </div>
        </section>

        <section id="maluf" className="film-school">
          <img className="film-school-photo" src="/maluf-school-front.jpg" alt="Estudantes em frente ao Colégio Estadual Alfredo Moisés Maluf, em Maringá" width="2048" height="1152" loading="lazy" decoding="async" />
          <div className="film-school-shade" aria-hidden="true" />
          <div className="film-school-copy" data-film-reveal><span className="film-eyebrow">05 / Onde a ideia ganhou forma</span><h2>Da escola pública<br />para um problema real.</h2><p>Um projeto feito por estudantes, para mostrar como desenvolvimento de sistemas pode conectar o que aprendemos com o cotidiano de uma obra.</p><strong>Colégio Estadual Alfredo Moisés Maluf</strong><span>Maringá · Paraná</span></div>
          <div className="film-school-credit"><span>Fotografia: Nicole Luna / YJI</span><a href="https://youthjournalism.org/my-green-hometown-of-maringa-brazil/" target="_blank" rel="noreferrer">Fonte da imagem <ExternalLink size={14} /></a><a href="https://www.consultaescolas.pr.gov.br/consultaescolas/pages/templates/initial2.xhtml?codigoEstab=603&codigoMunicipio=1530" target="_blank" rel="noreferrer">Seed-PR <ExternalLink size={14} /></a></div>
        </section>

        <section id="equipe" className="film-team">
          <header className="film-section-heading" data-film-reveal><span className="film-eyebrow">06 / QUEM CONSTRUIU</span><h2><MotionWords text="Por trás do sistema," /><br /><em><MotionWords text="cinco pessoas." /></em></h2><p>Uma ideia construída com código, pesquisa, organização e comunicação.</p></header>
          <ol className="film-team-list" aria-label="Integrantes do projeto">
            {projectTeam.map((member,index) => <li key={member.name} data-film-reveal><span className="film-team-number">{String(index+1).padStart(2,'0')}</span><div><h3>{member.name}</h3><p>{member.role}</p></div><span className="film-team-discipline">{member.discipline}</span><ArrowRight size={24} aria-hidden="true" /></li>)}
          </ol>
        </section>

        <section className="film-final" id="encerramento">
          <div data-film-reveal><span className="film-eyebrow">O projeto começa na presença.</span><h2>E continua<br /><em>no que construímos.</em></h2><p>{formatDate(participant.occurredAt)} · {result.worksiteName}</p><button className="film-btn film-magnetic" data-tilt data-tilt-strength="2" onClick={close} disabled={leaving} type="button">Voltar ao terminal <ArrowRight size={18} /></button></div>
          <div className="film-receipt film-gradient-border"><Check size={20} /><div><span>Evidência desta leitura</span><strong>{count} {count === 1 ? 'registro confirmado' : 'registros confirmados'}</strong></div><span>{formatTime(participant.occurredAt)}</span></div>
          {count > 1 && <ol className="film-participant-list" aria-label="Participantes confirmados nesta leitura">{result.participants.map(item => <li key={item.id}><strong>{item.name}</strong><span>{item.punchType ? punchLabels[item.punchType] : 'Ponto'} · {formatTime(item.occurredAt)}</span><span>{item.emailSent ? 'E-mail enviado' : 'Registro confirmado'}</span></li>)}</ol>}
        </section>
      </main>
    </div>
  );
}
