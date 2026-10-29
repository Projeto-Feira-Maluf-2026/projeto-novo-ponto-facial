import { ArrowLeft, ArrowRight, Check, Eye, Lock, Mail, Moon, Pause, Play, ShieldCheck, Sun, X } from 'lucide-react';
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';

import type { PunchType } from '../types/domain';
import { formatInAppTimeZone } from '../utils/dateTime';
import {
  firstName,
  joinNames,
  type PresentationParticipantResult,
  type PresentationResult,
} from './presentationResult';
import { FACE_POINTS } from './facePoints';
import { projectTeam } from './presentationTeam';
import './presentation-show.css';

interface PresentationShowProps {
  result: PresentationResult;
  onClose: () => void;
}

const punchLabels: Record<PunchType, string> = {
  ENTRY: 'Entrada',
  LUNCH_OUT: 'Saída para o intervalo',
  LUNCH_IN: 'Volta do intervalo',
  EXIT: 'Saída',
};

const SCENE_DURATIONS = {
  welcome: 7_000,
  face: 8_500,
  code: 8_500,
  match: 8_000,
  record: 8_500,
  care: 8_500,
  school: 8_500,
  team: 9_000,
  finale: 6_500,
} as const;

type SceneId = keyof typeof SCENE_DURATIONS;
const SCENES = Object.keys(SCENE_DURATIONS) as SceneId[];

const SCENE_LABELS: Record<SceneId, string> = {
  welcome: 'Boas-vindas',
  face: 'O rosto',
  code: 'O código',
  match: 'A comparação',
  record: 'O registro',
  care: 'Os dados',
  school: 'A escola',
  team: 'A equipe',
  finale: 'Até logo',
};

/** Explosão de confete em CSS: ângulos e distâncias fixos, sem aleatoriedade por render. */
function Burst({ count = 18 }: { count?: number }) {
  return (
    <span className="show-burst" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <span
          key={index}
          style={{
            '--a': `${(index / count) * 360 + (index % 2 ? 9 : -6)}deg`,
            '--d': `${110 + (index * 37) % 90}px`,
            '--s': (index % 3) + 1,
            '--i': index,
          } as CSSProperties}
        />
      ))}
    </span>
  );
}

type ShowTheme = 'light' | 'dark';
const THEME_STORAGE_KEY = 'curitiba:presentation-theme';

function readShowTheme(): ShowTheme {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function formatTime(value: Date) {
  return formatInAppTimeZone(value, { hour: '2-digit', minute: '2-digit' });
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : (parts[0] || '?').slice(0, 2);
  return letters.toUpperCase();
}

/** Pseudo-aleatório determinístico: a "assinatura" ilustrativa muda com o nome, sem usar biometria. */
function signatureBars(seed: string, count: number) {
  let state = 2166136261;
  for (const character of seed) state = Math.imul(state ^ character.charCodeAt(0), 16777619);
  return Array.from({ length: count }, () => {
    state = Math.imul(state ^ (state >>> 15), 2246822507);
    state = Math.imul(state ^ (state >>> 13), 3266489909);
    state ^= state >>> 16;
    return 0.28 + ((state >>> 0) % 1000) / 1000 * 0.72;
  });
}

function MotionText({ text, className }: { text: string; className?: string }) {
  let offset = 0;
  // Letras animam uma a uma, mas cada palavra fica inteira: o nome nunca quebra no meio.
  return (
    <span className={className} aria-label={text}>
      {text.split(' ').map((word, wordIndex) => {
        const start = offset;
        offset += word.length + 1;
        return (
          <Fragment key={`${word}-${wordIndex}`}>
            {wordIndex > 0 && ' '}
            <span className="show-word" aria-hidden="true">
              {Array.from(word).map((character, index) => (
                <span key={index} className="show-char" style={{ '--i': start + index } as CSSProperties}>
                  {character}
                </span>
              ))}
            </span>
          </Fragment>
        );
      })}
    </span>
  );
}

function ConstructionBackdrop({ level }: { level: number }) {
  const floors = SCENES.length;
  return (
    <svg className="show-construction" viewBox="0 0 520 620" aria-hidden="true">
      <g className="show-crane">
        <path d="M430 610 V70 M418 610 V70 M430 70 L60 70 M430 70 L470 70 L470 96 L430 96" />
        <path className="show-crane-lattice" d="M418 600 L430 580 L418 560 L430 540 L418 520 L430 500 L418 480 L430 460 L418 440 L430 420 L418 400 L430 380 L418 360 L430 340 L418 320 L430 300 L418 280 L430 260 L418 240 L430 220 L418 200 L430 180 L418 160 L430 140 L418 120 L430 100" />
        <g className="show-crane-hook" style={{ '--hook': level / floors } as CSSProperties}>
          <path d="M150 70 V160" />
          <rect x="138" y="160" width="24" height="16" rx="3" />
        </g>
      </g>
      {Array.from({ length: floors }, (_, floor) => {
        const y = 586 - floor * 56;
        const built = floor <= level;
        return (
          <g key={floor} className="show-floor" data-built={built || undefined} style={{ '--f': floor } as CSSProperties}>
            <rect className="show-slab" x="70" y={y} width="300" height="8" rx="2" />
            {[78, 168, 258, 348].map((x) => <rect key={x} className="show-column" x={x} y={y - 48} width="14" height="48" />)}
            {[96, 186, 276].map((x, windowIndex) => (
              <rect
                key={x}
                className="show-window"
                x={x}
                y={y - 40}
                width="66"
                height="32"
                rx="2"
                style={{ '--w': (floor * 3 + windowIndex) % 5 } as CSSProperties}
              />
            ))}
          </g>
        );
      })}
      <path className="show-ground" d="M10 596 H510" />
    </svg>
  );
}

function FaceMesh() {
  const contour = FACE_POINTS.slice(0, 17).map(([x, y]) => `${x},${y}`).join(' ');
  return (
    <div className="show-visual show-face" aria-hidden="true">
      <svg viewBox="0 0 400 520">
        <g className="show-face-frame">
          <path d="M40 92 V40 H92" /><path d="M308 40 H360 V92" /><path d="M360 428 V480 H308" /><path d="M92 480 H40 V428" />
        </g>
        <polyline className="show-face-contour" points={contour} />
        <path className="show-face-bridge" d="M136 196 L200 190 L264 196 M200 190 L200 262 M156 320 L200 282 L244 320" />
        {FACE_POINTS.map(([x, y], index) => (
          <circle key={index} className="show-face-point" cx={x} cy={y} r="3.4" style={{ '--i': index } as CSSProperties} />
        ))}
        <rect className="show-face-scan" x="40" y="40" width="320" height="3" rx="1.5" />
      </svg>
      <span className="show-visual-caption">Ilustração · nenhuma imagem da câmera aparece aqui</span>
    </div>
  );
}

function CodeSignature({ seed }: { seed: string }) {
  const bars = useMemo(() => signatureBars(seed, 72), [seed]);
  const values = useMemo(
    () => signatureBars(`${seed}#valores`, 24).map((value, index) => ((value - 0.64) * (index % 3 === 0 ? -1 : 1)).toFixed(3)),
    [seed],
  );
  return (
    <div className="show-visual show-code" aria-hidden="true">
      <div className="show-code-stream">
        <span>{[...values, ...values].map((value, index) => <i key={index}>{value}</i>)}</span>
      </div>
      <div className="show-code-ring">
        {bars.map((length, index) => (
          <span
            key={index}
            style={{ '--a': `${(index / bars.length) * 360}deg`, '--l': length, '--i': index } as CSSProperties}
          />
        ))}
        <div className="show-code-core"><strong>512</strong><small>números</small></div>
      </div>
      <span className="show-visual-caption">Ilustração · o código de verdade fica só no servidor</span>
    </div>
  );
}

function MatchBoard({ participants }: { participants: PresentationParticipantResult[] }) {
  const matches = participants.slice(0, 5);
  const slots = Array.from({ length: 6 }, (_, index) => matches[index] ?? null);
  return (
    <div className="show-visual show-match" aria-hidden="true">
      <div className="show-match-grid">
        {slots.map((participant, index) => (
          <div key={participant?.id || `slot-${index}`} className="show-match-card" data-match={participant ? 'true' : undefined} style={{ '--i': index } as CSSProperties}>
            <span className="show-match-avatar">{participant ? initials(participant.name) : ''}</span>
            <span className="show-match-name">{participant ? firstName(participant.name) : 'Cadastro'}</span>
            <span className="show-match-state">{participant ? <><Check size={14} /> É você</> : 'Não confere'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function emailLine(participants: PresentationParticipantResult[]) {
  const withEmail = participants.filter((participant) => participant.email !== 'none');
  if (!withEmail.length) return 'Quem tem e-mail no cadastro também recebe uma confirmação por lá.';
  if (participants.length === 1) {
    return withEmail[0].email === 'sent'
      ? 'E já mandamos a confirmação para o seu e-mail.'
      : 'E a confirmação já está a caminho do seu e-mail.';
  }
  return withEmail.length === participants.length
    ? 'E cada um vai receber a confirmação no próprio e-mail.'
    : `${withEmail.length} de vocês vão receber a confirmação por e-mail.`;
}

function Receipt({ result }: { result: PresentationResult }) {
  const participants = result.participants.slice(0, 5);
  return (
    <div className="show-visual show-receipt-wrap" aria-hidden="true">
      <div className="show-receipt">
        <header><span>Registro de ponto</span><span>{result.worksiteCode || 'Obra'}</span></header>
        <ul>
          {participants.map((participant, index) => (
            <li key={participant.id} style={{ '--i': index } as CSSProperties}>
              <span className="show-receipt-avatar">{initials(participant.name)}</span>
              <span className="show-receipt-person">
                <strong>{participant.name}</strong>
                <small>{participant.punchType ? punchLabels[participant.punchType] : 'Ponto'} · {result.worksiteName}</small>
              </span>
              <time>{formatTime(participant.occurredAt)}</time>
            </li>
          ))}
        </ul>
        <footer><Check size={16} /> Salvo no histórico</footer>
        <span className="show-receipt-stamp">Registrado</span>
        {participants.some((participant) => participant.email !== 'none') && (
          <span className="show-envelope"><Mail size={20} /></span>
        )}
      </div>
    </div>
  );
}

export function PresentationShow({ result, onClose }: PresentationShowProps) {
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const countdownRef = useRef<HTMLSpanElement | null>(null);
  const elapsedRef = useRef(0);
  const closingRef = useRef(false);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [theme, setTheme] = useState<ShowTheme>(readShowTheme);

  const toggleTheme = () => {
    const next: ShowTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Sem armazenamento, a escolha vale só para esta apresentação.
    }
  };

  const participants = result.participants;
  const lead = participants[0];
  const group = participants.length > 1;
  const names = participants.map((participant) => firstName(participant.name));
  const scene = SCENES[index];

  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setLeaving(true);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.setTimeout(onClose, reduced ? 0 : 420);
  }, [onClose]);

  const goTo = useCallback((next: number) => {
    if (next >= SCENES.length) {
      close();
      return;
    }
    elapsedRef.current = 0;
    rootRef.current?.style.setProperty('--scene-progress', '0');
    setIndex(Math.max(0, next));
  }, [close]);

  useEffect(() => {
    if (paused || leaving) return undefined;
    let frame = 0;
    let last = performance.now();
    const duration = SCENE_DURATIONS[scene];
    const tick = (now: number) => {
      elapsedRef.current += Math.min(now - last, 100);
      last = now;
      const progress = Math.min(1, elapsedRef.current / duration);
      rootRef.current?.style.setProperty('--scene-progress', progress.toFixed(4));
      if (scene === 'finale' && countdownRef.current) {
        countdownRef.current.textContent = String(Math.max(1, Math.ceil((duration - elapsedRef.current) / 1000)));
      }
      if (progress >= 1) {
        goTo(index + 1);
        return;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [goTo, index, leaving, paused, scene]);

  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      } else if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault();
        goTo(index + 1);
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        goTo(index - 1);
      } else if (event.key === ' ' && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault();
        setPaused((current) => !current);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close, goTo, index]);

  if (!lead) return null;

  const greeting = group ? 'Oi, pessoal!' : `Oi, ${firstName(lead.name)}!`;
  const welcomeText = group
    ? `A câmera reconheceu ${joinNames(names)} de uma vez só, e cada um ganhou o próprio registro.`
    : 'Que bom ter você aqui. A câmera te reconheceu e o seu ponto já está salvo.';
  const sceneState = (position: number) => (position === index ? 'active' : position < index ? 'before' : 'after');

  return (
    <div
      ref={rootRef}
      className="presentation-show"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-scene={scene}
      data-show-theme={theme}
      data-paused={paused || undefined}
      data-leaving={leaving || undefined}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('button, a')) return;
        goTo(index + 1);
      }}
    >
      <div className="show-atmosphere" aria-hidden="true">
        <span className="show-aurora show-aurora-a" />
        <span className="show-aurora show-aurora-b" />
        <span className="show-aurora show-aurora-c" />
        <span className="show-grid" />
      </div>
      <ConstructionBackdrop level={index} />
      <span key={`numeral-${index}`} className="show-numeral" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
      <span key={`sweep-${index}`} className="show-sweep" aria-hidden="true" />

      <header className="show-topbar">
        <div className="show-brand">
          <img src="/curitiba-mark.svg" alt="" width="32" height="32" />
          <span>Curitiba Empreiteira<small>Ponto facial · Feira de Tecnologia</small></span>
        </div>
        <p key={`chapter-${index}`} className="show-chapter" aria-hidden="true">
          <span>{String(index + 1).padStart(2, '0')} / {String(SCENES.length).padStart(2, '0')}</span>
          {SCENE_LABELS[scene]}
        </p>
        <div className="show-controls">
          <button
            type="button"
            className="show-icon-button show-theme-toggle"
            onClick={toggleTheme}
            aria-label={theme === 'light' ? 'Usar versão escura' : 'Usar versão clara'}
            aria-pressed={theme === 'dark'}
            title={theme === 'light' ? 'Versão escura' : 'Versão clara'}
          >
            {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
          </button>
          <button type="button" className="show-icon-button" onClick={() => goTo(index - 1)} disabled={index === 0} aria-label="Cena anterior">
            <ArrowLeft size={18} />
          </button>
          <button type="button" className="show-icon-button" onClick={() => setPaused((current) => !current)} aria-label={paused ? 'Continuar apresentação' : 'Pausar apresentação'}>
            {paused ? <Play size={18} /> : <Pause size={18} />}
          </button>
          <button type="button" className="show-icon-button" onClick={() => goTo(index + 1)} aria-label="Próxima cena">
            <ArrowRight size={18} />
          </button>
          <button type="button" className="show-close" onClick={close}>
            <X size={18} /> <span>Voltar à câmera</span>
          </button>
        </div>
      </header>

      <nav className="show-progress" aria-label="Cenas da apresentação">
        {SCENES.map((id, position) => (
          <button
            key={id}
            type="button"
            className="show-progress-segment"
            data-state={sceneState(position)}
            aria-label={`Ir para a cena ${position + 1} de ${SCENES.length}`}
            aria-current={position === index ? 'step' : undefined}
            onClick={() => goTo(position)}
          >
            <span />
          </button>
        ))}
      </nav>

      <h1 id={titleId} className="sr-only">Apresentação do projeto Ponto Facial</h1>

      <main className="show-stage" aria-live="polite">
        <section className="show-scene show-scene-welcome" data-state={sceneState(0)} aria-hidden={index !== 0}>
          <div className="show-copy">
            <span className="show-eyebrow"><span className="show-dot" /> Ponto registrado às {formatTime(lead.occurredAt)}</span>
            <h2 className="show-greeting"><MotionText text={greeting} /></h2>
            <p className="show-lede">{welcomeText}</p>
            {group && (
              <ul className="show-name-chips" aria-label="Pessoas reconhecidas">
                {participants.map((participant, position) => (
                  <li key={participant.id} style={{ '--i': position } as CSSProperties}>
                    <span>{initials(participant.name)}</span>{participant.name}
                  </li>
                ))}
              </ul>
            )}
            <p className="show-hint">Nos próximos segundos, a gente mostra o que aconteceu por trás dessa leitura.</p>
          </div>
          <div className="show-visual show-badge" aria-hidden="true">
            <Burst />
            <svg viewBox="0 0 220 220">
              <circle className="show-badge-ring" cx="110" cy="110" r="92" />
              <circle className="show-badge-glow" cx="110" cy="110" r="70" />
              <path className="show-badge-check" d="M72 112 L99 139 L150 84" />
            </svg>
          </div>
        </section>

        <section className="show-scene show-scene-split" data-state={sceneState(1)} aria-hidden={index !== 1}>
          <div className="show-copy">
            <span className="show-eyebrow">Passo 1 · Encontrar o rosto</span>
            <h2>Primeiro, a câmera <em>te encontrou.</em></h2>
            <p className="show-lede">Ela marca pontos como olhos, nariz e boca para saber onde está o rosto. Ninguém precisa apertar botão: basta olhar para a tela.</p>
            {group && <p className="show-note">Com várias pessoas no quadro, cada rosto é separado e analisado sozinho.</p>}
          </div>
          <FaceMesh />
        </section>

        <section className="show-scene show-scene-split" data-state={sceneState(2)} aria-hidden={index !== 2}>
          <div className="show-copy">
            <span className="show-eyebrow">Passo 2 · Transformar em números</span>
            <h2>Depois, o rosto <em>vira um código.</em></h2>
            <p className="show-lede">Uma inteligência artificial transforma o rosto em 512 números. É como uma impressão digital do rosto, e é ela que o sistema compara, não a foto.</p>
          </div>
          <CodeSignature seed={participants.map((participant) => participant.name).join('|')} />
        </section>

        <section className="show-scene show-scene-split" data-state={sceneState(3)} aria-hidden={index !== 3}>
          <div className="show-copy">
            <span className="show-eyebrow">Passo 3 · Comparar</span>
            <h2>Aí vem a <em>comparação.</em></h2>
            <p className="show-lede">O código é comparado com o de quem está cadastrado nesta obra. O ponto só é registrado quando a semelhança é forte. Na dúvida, o sistema prefere pedir uma nova leitura do que errar.</p>
          </div>
          <MatchBoard participants={participants} />
        </section>

        <section className="show-scene show-scene-split" data-state={sceneState(4)} aria-hidden={index !== 4}>
          <div className="show-copy">
            <span className="show-eyebrow">Passo 4 · Registrar</span>
            <h2>Pronto, <em>ponto batido.</em></h2>
            <p className="show-lede">Horário, obra e tipo de registro ficaram salvos no histórico, prontos para a equipe conferir. {emailLine(participants)}</p>
          </div>
          <Receipt result={result} />
        </section>

        <section className="show-scene show-scene-care" data-state={sceneState(5)} aria-hidden={index !== 5}>
          <div className="show-copy show-copy-center">
            <span className="show-eyebrow">E o cuidado com os dados?</span>
            <h2>Rosto é <em>coisa séria.</em></h2>
            <p className="show-lede">Biometria é um dado pessoal sensível, então o projeto foi pensado com isso em mente desde o começo.</p>
          </div>
          <ul className="show-care-list">
            <li style={{ '--i': 0 } as CSSProperties}><ShieldCheck size={26} /><strong>Só com autorização</strong><span>O reconhecimento só funciona para quem fez o cadastro e aceitou participar.</span></li>
            <li style={{ '--i': 1 } as CSSProperties}><Lock size={26} /><strong>A foto não fica guardada</strong><span>Na hora de reconhecer, o sistema guarda apenas os números, não a imagem da câmera.</span></li>
            <li style={{ '--i': 2 } as CSSProperties}><Eye size={26} /><strong>Tudo pode ser conferido</strong><span>Cada registro fica no histórico, e correções deixam rastro na auditoria.</span></li>
          </ul>
          <p className="show-footnote">É um projeto de feira, não um produto certificado. Luz, distância e a qualidade da câmera ainda mudam o resultado.</p>
        </section>

        <section className="show-scene show-scene-school" data-state={sceneState(6)} aria-hidden={index !== 6}>
          <img className="show-school-photo" src="/maluf-school-front.jpg" alt="Estudantes em frente ao Colégio Estadual Alfredo Moisés Maluf, em Maringá" width="2048" height="1152" decoding="async" />
          <span className="show-school-shade" aria-hidden="true" />
          <div className="show-copy">
            <span className="show-eyebrow">De onde veio a ideia</span>
            <h2>Feito por alunos, <em>para um problema de verdade.</em></h2>
            <p className="show-lede">Somos estudantes do Colégio Estadual Alfredo Moisés Maluf, em Maringá. Quisemos usar o que aprendemos em sala, programação, banco de dados e muita tentativa e erro, para facilitar o controle de presença numa obra.</p>
            <small className="show-credit">Foto: Nicole Luna / Youth Journalism International</small>
          </div>
        </section>

        <section className="show-scene show-scene-team" data-state={sceneState(7)} aria-hidden={index !== 7}>
          <div className="show-copy">
            <span className="show-eyebrow">Quem fez</span>
            <h2>Cinco pessoas, <em>uma ideia.</em></h2>
          </div>
          <ol className="show-team" aria-label="Integrantes do projeto">
            {projectTeam.map((member, position) => (
              <li key={member.name} style={{ '--i': position } as CSSProperties}>
                <span className="show-team-index">{String(position + 1).padStart(2, '0')}</span>
                <strong>{member.name}</strong>
                <span className="show-team-role">{member.role}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="show-scene show-scene-finale" data-state={sceneState(8)} aria-hidden={index !== 8}>
          <Burst count={28} />
          <div className="show-copy show-copy-center">
            <span className="show-eyebrow">Obrigado!</span>
            <h2 className="show-greeting"><MotionText text={group ? 'Valeu pela visita!' : `Valeu, ${firstName(lead.name)}!`} /></h2>
            <p className="show-lede">{group ? 'Esperamos que vocês tenham curtido' : 'Esperamos que você tenha curtido'} ver como tudo funciona por dentro.</p>
            <p className="show-countdown">Voltando para a câmera em <span ref={countdownRef}>{Math.ceil(SCENE_DURATIONS.finale / 1000)}</span>s</p>
          </div>
        </section>
      </main>
    </div>
  );
}
