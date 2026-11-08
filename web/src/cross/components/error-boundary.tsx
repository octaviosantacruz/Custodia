import { Component, type ErrorInfo, type ReactNode } from "react";
import './error-boundary.css';
import { t } from '../i18n/index.ts';

type Props = { children: ReactNode };
type State = { hasError: boolean };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Error no controlado en la interfaz", error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return <main className="app-error-state">
      <div role="alert">
        <p className="eyebrow">CUSTODIA</p>
        <h1>{t('Ocurrió un error inesperado')}</h1>
        <p>{t('La vista no pudo cargarse. Podés reintentar sin perder los datos guardados.')}</p>
        <button className="button primary" type="button" onClick={() => window.location.reload()}>{t('Reintentar')}</button>
      </div>
    </main>;
  }
}
