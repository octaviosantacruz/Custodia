/**
 * Transporte HTTP común hacia /api: envía la cookie de sesión y normaliza
 * errores con status, ruta y requestId. Los endpoints y tipos de cada dominio
 * se definen en el lib/ de su herramienta, usando este transporte.
 */
const API_URL = `${import.meta.env.VITE_API_URL || ""}/api`;

export class ApiError extends Error {
  status: number;
  path: string;
  requestId: string | null;

  constructor(message: string, status: number, path = '', requestId: string | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.path = path;
    this.requestId = requestId;
  }
}

function apiErrorMessage(detail: unknown, fallback: string): string {
  if (typeof detail === 'string' && detail.trim()) return detail.trim();
  if (Array.isArray(detail)) {
    const messages = detail.flatMap((item) => {
      if (!item || typeof item !== 'object' || !('msg' in item)) return [];
      const message = (item as { msg?: unknown }).msg;
      return typeof message === 'string' && message.trim()
        ? [message.trim().replace(/^Value error,\s*/i, '')]
        : [];
    });
    if (messages.length) return messages.join(' · ');
  }
  if (detail && typeof detail === 'object' && 'message' in detail) {
    const message = (detail as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message.trim();
  }
  return fallback;
}

/** Spanish explanation used when the response carries no usable `detail`
 *  (empty body, proxy HTML, network failure). Status 0 means no response. */
export function messageForStatus(status: number): string {
  if (status === 0) return 'No se pudo conectar con el servidor. Revisá tu conexión o si el servicio está en línea.';
  if (status === 401) return 'La sesión venció o no está iniciada.';
  if (status === 403) return 'Tu rol no tiene permiso para esta acción.';
  if (status === 404) return 'No se encontró el recurso solicitado.';
  if (status === 429) return 'Demasiadas solicitudes: esperá unos segundos y reintentá.';
  if (status === 502 || status === 503 || status === 504) return 'El servicio no está disponible en este momento (puede estar reiniciándose o sin acceso a la base de datos).';
  if (status >= 500) return 'El servidor tuvo un error al procesar la solicitud.';
  return 'No se pudo completar la solicitud.';
}

/** Plain-text bodies are only trusted when short and not markup (proxy error pages). */
function usableRawDetail(raw: string): string {
  const text = raw.trim();
  return text && text.length <= 300 && !text.startsWith('<') ? text : '';
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      credentials: 'include',
      headers: {
        ...(options?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(options?.headers || {}),
      },
      ...options,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(messageForStatus(0), 0, path, null);
  }
  const raw = await response.text();
  let data: { detail?: unknown };
  try {
    data = JSON.parse(raw) as { detail?: unknown };
  } catch {
    data = { detail: usableRawDetail(raw) || messageForStatus(response.status) };
  }
  if (!response.ok) throw new ApiError(apiErrorMessage(data.detail, messageForStatus(response.status)), response.status, path, response.headers.get('x-request-id'));
  return data as T;
}


export async function logout(): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/auth/logout`, { method: 'POST', credentials: 'include' });
    return response.ok;
  } catch {
    return false;
  }
}


export async function download(path: string, filename: string): Promise<void> {
  const response = await fetch(`${API_URL}${path}`, { credentials: 'include' });
  if (!response.ok) {
    const raw = await response.text();
    try {
      const data = JSON.parse(raw) as { detail?: unknown };
      throw new ApiError(apiErrorMessage(data.detail, 'No se pudo exportar el inventario'), response.status, path, response.headers.get('x-request-id'));
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(raw || 'No se pudo exportar el inventario', response.status, path, response.headers.get('x-request-id'));
    }
  }
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
