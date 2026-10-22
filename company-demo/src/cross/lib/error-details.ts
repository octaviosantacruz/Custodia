import { ApiError } from './api';

export type ErrorDetails = {
  message: string;
  status?: number;
  path?: string;
  requestId?: string | null;
};

/** Normalizes anything thrown by the API layer into fields safe to show in a technical detail dialog. */
export function errorDetailsFrom(error: unknown, fallback: string): ErrorDetails {
  if (error instanceof ApiError) return { message: error.message, status: error.status, path: error.path, requestId: error.requestId };
  return { message: error instanceof Error ? error.message : fallback };
}
