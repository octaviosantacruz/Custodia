const API_URL = `${import.meta.env.VITE_API_URL || ""}/api`;

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    headers: {
      ...(options?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(options?.headers || {}),
    },
    ...options,
  });
  const raw = await response.text();
  let data: { detail?: string };
  try {
    data = JSON.parse(raw) as { detail?: string };
  } catch {
    data = { detail: raw || "No se pudo completar la solicitud" };
  }
  if (!response.ok) throw new ApiError(data.detail || "No se pudo completar la solicitud", response.status);
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
      const data = JSON.parse(raw) as { detail?: string };
      throw new ApiError(data.detail || 'No se pudo exportar el inventario', response.status);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(raw || 'No se pudo exportar el inventario', response.status);
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
