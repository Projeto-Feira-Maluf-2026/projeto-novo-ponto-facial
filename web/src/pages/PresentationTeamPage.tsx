import { ArrowLeft, Code2, Lightbulb, Pause, Play, Sparkles } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState, type CSSProperties } from 'react';

import { projectTeam } from '../presentation/presentationTeam';
import './presentation-team.css';

const NeuralFaceBackdrop = lazy(async () => {
  const module = await import('../presentation/NeuralFaceBackdrop');
  return { default: module.NeuralFaceBackdrop };
});

export function PresentationTeamPage() {
  const systemReduced = useMemo(
    () => typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );
  const [motionPaused, setMotionPaused] = useState(systemReduced);

  useEffect(() => {
    document.title = 'Equipe do projeto | Curitiba Empreiteira';
    const elements = Array.from(document.querySelectorAll<HTMLElement>('[data-team-reveal]'));
    if (systemReduced || typeof IntersectionObserver === 'undefined') {
      elements.forEach((element) => element.dataset.visible = 'true');
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) (entry.target as HTMLElement).dataset.visible = 'true';
      });
    }, { threshold: 0.18 });
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [systemReduced]);

  const closePage = () => {
    window.close();
    window.setTimeout(() => {
      if (!window.closed) window.location.assign('/apresentacao');
    }, 120);
  };

  return (
    <div className="team-story" data-motion-paused={motionPaused || undefined}>
      <Suspense fallback={null}><NeuralFaceBackdrop paused={motionPaused} /></Suspense>
      <div className="team-story-grid" aria-hidden="true" />
      <header className="team-story-nav">
        <div><strong>Curitiba Empreiteira</strong><small>Créditos do projeto · Feira de Tecnologia</small></div>
        <div>
          <button type="button" onClick={() => setMotionPaused((current) => !current)} aria-pressed={motionPaused}>
            {motionPaused ? <Play size={16} /> : <Pause size={16} />}
            {motionPaused ? 'Ativar movimento' : 'Pausar movimento'}
          </button>
          <button type="button" onClick={closePage}><ArrowLeft size={17} /> Voltar</button>
        </div>
      </header>

      <main>
        <section className="team-story-hero">
          <div className="team-story-kicker">AUTORIA · MALUF 2026</div>
          <h1 aria-label="Pessoas por trás da inteligência."><span>Pessoas por trás</span><span>da inteligência.</span></h1>
          <p>
            Um sistema de reconhecimento facial só existe quando código, organização,
            pesquisa e comunicação trabalham como uma única estrutura.
          </p>
          <a href="#integrantes">Conheça os 5 integrantes <span aria-hidden="true">↓</span></a>
          <div className="team-story-coordinate" aria-hidden="true">MARINGÁ · 23.4253° S · 51.9386° W</div>
        </section>

        <section id="integrantes" className="team-story-members" aria-labelledby="team-members-title">
          <header data-team-reveal>
            <span>01 / EQUIPE</span>
            <h2 id="team-members-title">5 olhares.<br />1 projeto.</h2>
          </header>
          <ol>
            {projectTeam.map((member, index) => (
              <li
                key={member.name}
                data-team-reveal
                style={{ '--member-order': index, '--member-x': index % 2 ? '70px' : '-70px' } as CSSProperties}
              >
                <span>{String(index + 1).padStart(2, '0')}</span>
                <div className="team-story-monogram" aria-hidden="true">
                  {member.name.split(' ').slice(0, 2).map((part) => part[0]).join('')}
                </div>
                <div><small>{member.discipline}</small><strong>{member.name}</strong></div>
                <p>{member.role}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="team-story-contributions">
          <header data-team-reveal><span>02 / CONTRIBUIÇÕES</span><h2>O que cada frente sustenta.</h2></header>
          <div>
            <article data-team-reveal><Code2 size={28} /><strong>Engenharia</strong><p>Interface, backend, reconhecimento facial, infraestrutura e integração do fluxo completo.</p></article>
            <article data-team-reveal><Lightbulb size={28} /><strong>Organização</strong><p>Pesquisa, roteiro da feira, ideias, validação da demonstração e clareza da apresentação.</p></article>
            <article data-team-reveal><Sparkles size={28} /><strong>Comunicação</strong><p>Cartaz, identidade visual e tradução da tecnologia para estudantes, professores e visitantes.</p></article>
          </div>
        </section>

        <footer className="team-story-footer" data-team-reveal>
          <span>Colégio Estadual Alfredo Moisés Maluf</span>
          <h2>Feito por estudantes.<br />Testado no mundo real.</h2>
          <button type="button" onClick={closePage}>Voltar para a apresentação <ArrowLeft size={17} /></button>
        </footer>
      </main>
    </div>
  );
}
