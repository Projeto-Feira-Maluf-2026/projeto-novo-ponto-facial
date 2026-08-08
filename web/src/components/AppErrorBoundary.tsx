import { Component, type ErrorInfo, type ReactNode } from 'react';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  failed: boolean;
}

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Falha ao renderizar a aplicação', error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="login-page">
          <section className="app-fatal-error" role="alert">
            <div className="auth-loading-mark">CE</div>
            <h1>Não foi possível abrir o sistema</h1>
            <p>Atualize a página para carregar uma versão íntegra da aplicação.</p>
            <button type="button" onClick={() => window.location.reload()}>
              Recarregar página
            </button>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
