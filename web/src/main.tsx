import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/instrument-sans';
import '@fontsource-variable/jetbrains-mono';
import './design/tokens.css';
import './design/base.css';
import './design/components.css';
import './design/pages.css';
import { App } from './App.tsx';
import { AppProvider } from './ui/router.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider><App /></AppProvider>
  </StrictMode>,
);
