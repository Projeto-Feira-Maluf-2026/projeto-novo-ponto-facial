import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App';
import { AuthProvider } from './auth/AuthContext';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import './styles.css';
import './premium.css';
import './motion.css';
import './redesign.css';
import './utility-effects.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </AppErrorBoundary>
  </React.StrictMode>,
);
