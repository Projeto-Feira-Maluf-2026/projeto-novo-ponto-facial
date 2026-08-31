import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Clock3,
  Database,
  ExternalLink,
  Fingerprint,
  Mail,
  Pause,
  Play,
  ScanFace,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { PunchType } from '../types/domain';
import type { PresentationResult } from './presentationResult';
import { queuePresentationResultForNavigation } from './presentationResultTransfer';
import { projectTeam } from './presentationTeam';

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
  return value.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(value: Date) {
  return value.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
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
  const [motionPaused, setMotionPaused] = useState(false);
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
      aria-labelledby={summaryTitleId}
    >
      <Suspense fallback={null}>
        <PresentationCinematicLayer
          rootRef={storyRef}
          paused={motionPaused}
        />
      </Suspense>
      <header className="presentation-story-nav">
        <div className="presentation-story-brand">
          <span aria-hidden="true">CE</span>
          <div><strong>Curitiba Empreiteira</strong><small>Construção e tecnologia</small></div>
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
          <button type="button" onClick={onClose}>
            <ArrowLeft size={17} /> Fechar resumo
          </button>
        </div>
      </header>

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
            width="2048"
            height="1152"
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
          <div className="presentation-team-giant-number" aria-hidden="true">06</div>
          <div className="presentation-team-teaser-copy" data-story-team-copy>
            <span className="presentation-story-index">06 / QUEM CONSTRUIU</span>
            <h3>O sistema é técnico.<br />A autoria é humana.</h3>
            <p>
              Desenvolvimento, organização, pesquisa e comunicação foram construídos em conjunto
              por cinco estudantes que transformaram a ideia em uma demonstração real.
            </p>
          </div>
          <ol className="presentation-story-team-list" aria-label="Integrantes do projeto">
            {projectTeam.map((member, index) => (
              <li key={member.name} data-story-team-member>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <div className="presentation-story-team-monogram" aria-hidden="true">
                  {member.name.split(' ').slice(0, 2).map((part) => part[0]).join('')}
                </div>
                <div>
                  <small>{member.discipline}</small>
                  <strong>{member.name}</strong>
                  <p>{member.role}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="presentation-story-final">
          <Sparkles size={24} aria-hidden="true" />
          <span>Curitiba Empreiteira · Construção e tecnologia</span>
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
    </div>
  );
}
