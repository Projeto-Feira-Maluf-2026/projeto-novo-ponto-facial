import {
  ArrowRight,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Mail,
} from 'lucide-react';
import { FormEvent, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useLoginMotion } from '../animations/useMotion';
import { useAuth } from '../auth/AuthContext';

export function LoginPage() {
  const loginRef = useRef<HTMLElement>(null);
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useLoginMotion(loginRef);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      await signIn(email.trim(), password);
      navigate('/', { viewTransition: true });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message.toLowerCase() : '';
      setError(
        message.includes('profile_missing')
          ? 'Sua conta não possui um perfil de acesso. Solicite a liberação ao administrador.'
          : message.includes('timeout') || message.includes('fetch') || message.includes('network')
            ? 'Não foi possível conectar ao serviço de login. Tente novamente em instantes.'
            : 'E-mail ou senha incorretos. Verifique os dados e tente novamente.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <main ref={loginRef} className="login-page">
      <div className="login-window">
        <aside className="login-context">
          <div className="login-context-grid" aria-hidden="true" />
          <div className="login-architecture" aria-hidden="true">
            <svg viewBox="0 0 700 800" preserveAspectRatio="xMidYMid slice" focusable="false">
              <g className="login-blueprint-city">
                <path className="login-blueprint-line" d="M24 694H676M44 724H654" />
                <path className="login-blueprint-volume" d="M28 694V532h112v162M54 532v-48h61v48M152 694V578h92v116" />
                <path className="login-blueprint-volume" d="M506 694V498h140v196M535 498v-66h76v66" />

                <g className="login-blueprint-building">
                  <path className="login-blueprint-volume login-blueprint-main" d="M255 694V214l42-34h210v514Z" />
                  <path className="login-blueprint-line" d="M297 180v514M507 214 297 180M355 190v504M418 199v495M476 208v486" />
                  <path className="login-blueprint-line" d="M255 694h274v20H236v-20ZM281 180v-26h242v540" />
                  <path className="login-blueprint-floor" d="M255 618h252" />
                  <path className="login-blueprint-floor" d="M255 550h252" />
                  <path className="login-blueprint-floor" d="M255 482h252" />
                  <path className="login-blueprint-floor" d="M255 414h252" />
                  <path className="login-blueprint-floor" d="M255 346h252" />
                  <path className="login-blueprint-floor" d="M255 278h252" />
                  <path className="login-blueprint-floor" d="M271 228h236" />
                  <path className="login-blueprint-accent" d="M320 618v-48h58v48M436 550v-48h44v48M373 414v-48h62v48" />
                </g>

                <g className="login-blueprint-crane">
                  <path className="login-blueprint-line" d="M560 694V142M548 694h24M552 142h16M560 142H262M560 156h84M282 142l-34 20M319 142l-34 20M356 142l-34 20M393 142l-34 20M430 142l-34 20" />
                  <path className="login-blueprint-line" d="M302 142v180M295 322h14M626 156v94M618 250h16" />
                </g>

                <path className="login-blueprint-scan" d="M176 96V736" />
              </g>
            </svg>
          </div>
          <div className="login-brand">
            <div className="login-brand-mark">CE</div>
            <div>
              <strong>Curitiba Empreiteira</strong>
            </div>
          </div>

          <div className="login-context-content">
            <h2>Controle de ponto facial</h2>
          </div>
        </aside>

        <section className="login-access">
          <div className="login-mobile-brand">
            <div className="login-brand-mark">CE</div>
            <strong>Curitiba Empreiteira</strong>
          </div>

          <form onSubmit={onSubmit} className="login-form" noValidate>
            <div className="login-form-heading">
              <h1>Entrar</h1>
            </div>

            <div className={`login-input ${error ? 'is-invalid' : ''}`}>
              <Mail size={19} aria-hidden="true" />
              <label htmlFor="login-email">
                <span>E-mail corporativo</span>
                <input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={(event) => { setEmail(event.target.value); if (error) setError(''); }}
                  placeholder="nome@empresa.com"
                  autoComplete="email"
                  inputMode="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? 'login-error' : undefined}
                  required
                />
              </label>
            </div>

            <div className={`login-input ${error ? 'is-invalid' : ''}`}>
              <LockKeyhole size={19} aria-hidden="true" />
              <label htmlFor="login-password">
                <span>Senha</span>
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => { setPassword(event.target.value); if (error) setError(''); }}
                  placeholder="Digite sua senha"
                  autoComplete="current-password"
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? 'login-error' : undefined}
                  required
                />
              </label>
              <button
                type="button"
                className="login-password-toggle"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            {error && <div id="login-error" className="login-error" role="alert">{error}</div>}

            <button type="submit" className="login-submit" disabled={loading || !email.trim() || !password}>
              <span>{loading ? 'Entrando...' : 'Entrar'}</span>
              {loading ? <LoaderCircle className="login-spinner" size={18} /> : <ArrowRight size={18} />}
            </button>

          </form>
        </section>
      </div>
    </main>
  );
}
