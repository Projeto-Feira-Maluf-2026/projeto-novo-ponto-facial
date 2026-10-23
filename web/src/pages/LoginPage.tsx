import {
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Mail,
} from 'lucide-react';
import { FormEvent, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { BrandMark } from '../components/BrandMark';
import './login.css';

/** Confirmações ilustrativas que flutuam ao fundo: mostram o que o sistema faz, sem dados reais. */
const AMBIENT_CHIPS = [
  { label: 'Entrada', detail: '07:42', x: '9%', y: '18%' },
  { label: 'Rosto reconhecido', detail: 'Obra Batel', x: '74%', y: '14%' },
  { label: 'Volta do intervalo', detail: '13:05', x: '6%', y: '72%' },
  { label: 'Saída', detail: '17:31', x: '78%', y: '76%' },
];

export function LoginPage() {
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (loading) return;
    if (!email.trim() || !password) {
      setError('Preencha o e-mail e a senha para entrar.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await signIn(email.trim(), password);
      navigate('/');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message.toLowerCase() : '';
      const status = Number((cause as { status?: unknown } | null)?.status) || 0;
      const unreachable = message.includes('timeout') || message.includes('fetch')
        || message.includes('network') || status >= 500;
      setError(
        message.includes('profile_missing')
          ? 'Sua conta ainda não tem um perfil de acesso. Peça a liberação ao administrador.'
          : status === 429
            ? 'Muitas tentativas de login seguidas. Aguarde alguns minutos e tente de novo.'
            : unreachable
              ? 'Não conseguimos falar com o serviço de login. Confira a internet e tente de novo.'
              : 'E-mail ou senha não conferem. Confira e tente de novo.',
      );
    } finally {
      setLoading(false);
    }
  };

  const clearError = () => {
    if (error) setError('');
  };

  return (
    <main className="auth">
      <div className="auth-backdrop" aria-hidden="true">
        <span className="auth-glow auth-glow-a" />
        <span className="auth-glow auth-glow-b" />
        <span className="auth-grid" />
        <span className="auth-scanline" />
        {AMBIENT_CHIPS.map((chip, index) => (
          <span
            key={chip.label}
            className="auth-chip"
            style={{ '--x': chip.x, '--y': chip.y, '--i': index } as CSSProperties}
          >
            <span className="auth-chip-icon"><Check size={13} /></span>
            <strong>{chip.label}</strong>
            <small>{chip.detail}</small>
          </span>
        ))}
      </div>

      <section className="auth-card">
        <header className="auth-identity">
          <span className="auth-logo">
            <BrandMark className="auth-logo-mark" />
          </span>
          <p className="auth-wordmark">Curitiba Empreiteira</p>
          <p className="auth-tagline">Ponto facial para a obra</p>
        </header>

        <form onSubmit={onSubmit} className="auth-form" noValidate>
          <h1 className="auth-title">Entrar na sua conta</h1>

          <label className="auth-field" htmlFor="login-email">
            <span className="auth-label">E-mail</span>
            <span className="auth-control" data-invalid={Boolean(error) || undefined}>
              <Mail size={18} aria-hidden="true" />
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(event) => { setEmail(event.target.value); clearError(); }}
                placeholder="nome@empresa.com"
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'login-error' : undefined}
                required
              />
            </span>
          </label>

          <label className="auth-field" htmlFor="login-password">
            <span className="auth-label">Senha</span>
            <span className="auth-control" data-invalid={Boolean(error) || undefined}>
              <LockKeyhole size={18} aria-hidden="true" />
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => { setPassword(event.target.value); clearError(); }}
                placeholder="Sua senha"
                autoComplete="current-password"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'login-error' : undefined}
                required
              />
              <button
                type="button"
                className="auth-reveal"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </span>
          </label>

          {error && <p id="login-error" className="auth-error" role="alert">{error}</p>}

          <button type="submit" className="auth-submit" disabled={loading} aria-busy={loading}>
            <span>{loading ? 'Entrando…' : 'Entrar'}</span>
            {loading ? <LoaderCircle className="auth-spinner" size={18} /> : <ArrowRight size={18} />}
          </button>
        </form>

        <p className="auth-help">Não consegue entrar? Fale com quem administra o sistema na sua obra.</p>
      </section>

      <footer className="auth-footer">Projeto da Feira de Tecnologia · Colégio Estadual Alfredo Moisés Maluf</footer>
    </main>
  );
}
