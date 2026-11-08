/**
 * Monta React, el cliente de consultas, el límite de errores y los estilos globales.
 * Creado por Octavio Santacruz. Guía de mantenimiento: MAINTAINING.md.
 * La sesión y la composición de workspaces se coordinan en App.tsx.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { App } from './App';
import { ErrorBoundary } from './cross/components/error-boundary';
import { dshubQueryClient } from './cross/lib/query-client';
import '@fontsource-variable/caveat';
import '@fontsource-variable/instrument-sans';
import '@fontsource-variable/jetbrains-mono';
import './styles/foundation.css';
import './styles.css';
import './styles/application-shell.css';
import './styles/motion.css';
import './cross/components/database-surface.css';
import './cross/components/personal-dashboard.css';
import './cross/components/catalog-modal.css';
import './cross/components/detail-drawer.css';
import './cross/components/identity-connection.css';
import './cross/components/workspace-subnav.css';
import './cross/components/cell-stack.css';
import './cross/components/notification-menu.css';
import './cross/components/app-notifications.css';

function render() {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={dshubQueryClient}>
        <ErrorBoundary><App /></ErrorBoundary>
        {/* FE-DEVTOOLS-001: panel de sólo desarrollo; el build productivo no lo incluye. */}
        {import.meta.env.DEV ? <ReactQueryDevtools initialIsOpen={false} /> : null}
      </QueryClientProvider>
    </React.StrictMode>,
  );
}

/* Demo estática (VITE_DEMO=1): la API simulada se instala antes del primer
   render y se carga aparte, así el build normal no la incluye. */
if (import.meta.env.VITE_DEMO === '1') {
  void import('./demo/install.ts').then(({ installDemoApi }) => { installDemoApi(); render(); });
} else {
  render();
}
