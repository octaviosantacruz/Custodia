/**
 * Demo estática: intercepta las llamadas a /api y las responde con la API
 * simulada (con los datos de Acme Corp de acme-api.ts), así la app corre sin backend (por ejemplo en Cloudflare Pages).
 * Sólo se carga cuando el build define VITE_DEMO=1; el resto de las
 * peticiones sale a la red sin cambios.
 */
import { createMockApi } from './mock-api.ts';
import { withAcmeData } from './acme-api.ts';

export const DEMO_USER = { actor_id: 'demo', name: 'Demo', email: 'demo@acme.example', roles: ['reader'], role_names: ['Lector'] };

export function installDemoApi() {
  const handle = withAcmeData(createMockApi({
    sessionUser: DEMO_USER,
    includeSafe: true,
    permissions: [
      'inventory:read', 'safes:read', 'coverage:read', 'catalogs:read', 'pam:catalogs_read',
      'identity:catalogs_read', 'netskope:read', 'audit:read',
    ],
  }));
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url, window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return realFetch(input, init);
    let body: unknown = null;
    const text = request.method === 'GET' || request.method === 'HEAD' ? '' : await request.text();
    if (text) { try { body = JSON.parse(text); } catch { body = text; } }
    const response = await handle({ url: url.href, method: request.method, body });
    return new Response(response.status === 204 ? null : response.body, { status: response.status, headers: { 'Content-Type': response.contentType } });
  };
}
