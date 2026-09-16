import { Component, type ErrorInfo, type ReactNode } from "react";

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
    return <main className="app-error-state" role="alert">
      <p className="eyebrow">DS HUB</p>
      <h1>Ocurrió un error inesperado</h1>
      <p>La vista no pudo cargarse. Podés reintentar sin perder los datos guardados.</p>
      <button className="button primary" type="button" onClick={() => window.location.reload()}>Reintentar</button>
    </main>;
  }
}
