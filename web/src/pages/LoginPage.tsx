import {
  ArrowRight,
  Eye,
  EyeOff,
  Fingerprint,
  LoaderCircle,
  LockKeyhole,
  Mail,
  ShieldCheck,
} from 'lucide-react';
import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { ConstructionScene3D } from '../components/ConstructionScene3D';

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
    setLoading(true);
    setError('');
    try {
      await signIn(email.trim(), password);
      navigate('/');
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
    <main className="login-page">
      <section className="login-visual" aria-label="Curitiba Empreiteira">
        <header className="login-brand">
          <span className="login-brand-mark">CE</span>
          <span>
            <strong>Curitiba Empreiteira</strong>
            <small>Controle operacional</small>
          </span>
        </header>

        <div className="login-visual-copy">
          <span className="login-index">PLATAFORMA / 01</span>
          <h1>Precisão na obra.<br />Controle em campo.</h1>
          <p>Presença facial, equipes e canteiros conectados à mesma operação.</p>
        </div>

        <ConstructionScene3D className="login-construction-scene" />

        <footer className="login-visual-footer">
          <span><Fingerprint size={15} /> Biometria protegida</span>
          <span>CURITIBA · PR</span>
        </footer>
      </section>

      <section className="login-access">
        <div className="login-access-grid" aria-hidden="true" />
        <div className="login-mobile-brand">
          <span className="login-brand-mark">CE</span>
          <strong>Curitiba Empreiteira</strong>
        </div>

        <form onSubmit={onSubmit} className="login-form" noValidate>
          <div className="login-form-heading">
            <span className="login-form-kicker">ACESSO RESTRITO</span>
            <h2>Central de operação</h2>
            <p>Entre com as credenciais fornecidas pela empresa.</p>
          </div>

          <label className={`login-field ${error ? 'is-invalid' : ''}`} htmlFor="login-email">
            <span>E-mail corporativo</span>
            <div>
              <Mail size={18} aria-hidden="true" />
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
            </div>
          </label>

          <label className={`login-field ${error ? 'is-invalid' : ''}`} htmlFor="login-password">
            <span>Senha</span>
            <div>
              <LockKeyhole size={18} aria-hidden="true" />
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
              <button
                type="button"
                className="login-password-toggle"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>

          {error && <div id="login-error" className="login-error" role="alert">{error}</div>}

          <button type="submit" className="login-submit" disabled={loading || !email.trim() || !password}>
            <span>{loading ? 'Validando acesso...' : 'Acessar plataforma'}</span>
            {loading ? <LoaderCircle className="login-spinner" size={18} /> : <ArrowRight size={18} />}
          </button>

          <p className="login-privacy"><ShieldCheck size={14} /> Ambiente monitorado e protegido</p>
        </form>

        <span className="login-version">SISTEMA 02.26</span>
      </section>
    </main>
  );
}
