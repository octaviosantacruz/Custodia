import { company } from '../model/company.ts';
import { SOURCE_ORDER } from '../model/view.ts';
import { Mark, Seal, VerdictGlyph } from '../ui/identity.tsx';
import { navigate, useApp, useLocation } from '../ui/router.tsx';

export function Login() {
  const { signIn } = useApp();
  const { params } = useLocation();
  const back = params.get('volver');
  // Sólo rutas internas de la demo: nunca un destino externo.
  const enter = () => { signIn(); navigate(back && /^\/[a-z0-9/-]*$/.test(back) ? back : '/'); };

  return (
    <div className="login">
      <section className="login-story" aria-labelledby="login-title">
        <span className="login-mark"><Mark size={44} /></span>
        <h1 id="login-title">Lo que tus herramientas saben, <em>juntas</em>.</h1>
        <p>
          Custodia cruza tus herramientas de seguridad, hoy CyberArk y Netskope, para encontrar lo que ninguna ve sola.
          Cada conclusión dice qué regla la produjo y qué fuente la sostiene.
        </p>
        <figure className="login-chain" aria-label="Ejemplo: dos fuentes sostienen una brecha">
          <div className="login-chain-row">
            {SOURCE_ORDER.map(key => <Seal key={key} source={key} label="product" />)}
          </div>
          <figcaption>
            <VerdictGlyph status="gap" /> Acceso privilegiado sin ningún equipo observado
          </figcaption>
        </figure>
      </section>

      <section className="login-panel" aria-labelledby="login-panel-title">
        <div className="login-card">
          <p className="label">Organización</p>
          <h2 id="login-panel-title">{company.name}</h2>
          <p className="muted">Empresa ficticia con datos sintéticos. La demo es de sólo lectura y no envía nada a ningún servidor.</p>

          <button type="button" className="button is-primary is-wide" onClick={enter}>Entrar a la demo</button>

          <div className="divider"><span>acceso real</span></div>

          <button type="button" className="button is-wide" disabled aria-describedby="login-sso-note">Entrar con passkey o SSO</button>
          <p id="login-sso-note" className="hint">Diseñado para entrar por Switchboard u OIDC genérico. Todavía no está implementado.</p>
        </div>
        <p className="login-foot">custodia · CMDB de seguridad de código abierto · demo</p>
      </section>
    </div>
  );
}
