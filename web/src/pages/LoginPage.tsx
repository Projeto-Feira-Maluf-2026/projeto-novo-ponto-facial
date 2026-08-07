import {
  ArrowRight,
  Building2,
  Camera,
  CheckCircle2,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  ShieldCheck,
} from 'lucide-react';
import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { apiClient } from '../services/api';

export function LoginPage() {
  const navigate = useNavigate();
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
      await apiClient.login(email.trim(), password);
      navigate('/');
    } catch {
      setError('E-mail ou senha incorretos. Verifique os dados e tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-page">
      <div className="login-window">
        <aside className="login-context">
          <div className="login-brand">
            <div className="login-brand-mark">CE</div>
            <div>
              <strong>Curitiba Empreiteira</strong>
              <span>Controle de presença</span>
            </div>
          </div>

          <div className="login-context-content">
            <span className="login-context-label">Operação centralizada</span>
            <h1>Presença confiável, sem interromper a rotina.</h1>
            <p>
              Terminais automáticos, equipes e obras reunidos em um ambiente simples
              para acompanhar.
            </p>

            <div className="login-operation-card">
              <div className="login-operation-header">
                <div>
                  <span>Status do sistema</span>
                  <strong>Operação disponível</strong>
                </div>
                <span className="login-live-indicator">
                  <i />
                  Online
                </span>
              </div>
              <div className="login-operation-list">
                <div>
                  <Camera size={17} />
                  <span>Terminais faciais</span>
                  <CheckCircle2 size={17} />
                </div>
                <div>
                  <Building2 size={17} />
                  <span>Gestão por obra</span>
                  <CheckCircle2 size={17} />
                </div>
                <div>
                  <ShieldCheck size={17} />
                  <span>Dados protegidos</span>
                  <CheckCircle2 size={17} />
                </div>
              </div>
            </div>
          </div>

          <p className="login-context-footer">
            Ambiente corporativo · acesso monitorado
          </p>
        </aside>

        <section className="login-access">
          <div className="login-mobile-brand">
            <div className="login-brand-mark">CE</div>
            <strong>Curitiba Empreiteira</strong>
          </div>

          <form onSubmit={onSubmit} className="login-form" noValidate>
            <div className="login-form-icon">
              <LockKeyhole size={21} />
            </div>
            <div className="login-form-heading">
              <h2>Bem-vindo</h2>
              <p>Entre com sua conta corporativa.</p>
            </div>

            <div className={`login-input ${error ? 'is-invalid' : ''}`}>
              <Mail size={19} aria-hidden="true" />
              <label htmlFor="login-email">
                <span>E-mail corporativo</span>
                <input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    if (error) setError('');
                  }}
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
                  onChange={(event) => {
                    setPassword(event.target.value);
                    if (error) setError('');
                  }}
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

            {error && (
              <div id="login-error" className="login-error" role="alert">
                {error}
              </div>
            )}

            <button
              type="submit"
              className="login-submit"
              disabled={loading || !email.trim() || !password}
            >
              <span>{loading ? 'Entrando...' : 'Entrar no sistema'}</span>
              <ArrowRight size={18} />
            </button>

            <p className="login-privacy">
              Suas ações administrativas são registradas para segurança.
            </p>
          </form>
        </section>
      </div>
    </main>
  );
}
