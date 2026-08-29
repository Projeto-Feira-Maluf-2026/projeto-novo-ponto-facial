import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App';
import { AuthProvider } from './auth/AuthContext';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { PresentationProvider } from './presentation/PresentationContext';
import './styles.css';
import './premium.css';
import './motion.css';
import './redesign.css';
import './utility-effects.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <AuthProvider>
        <PresentationProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </PresentationProvider>
      </AuthProvider>
    </AppErrorBoundary>
  </React.StrictMode>,
);
