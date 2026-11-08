import { api } from '../../../cross/lib/api';
import type {
  PamComponentListResponse, PamConnectorListResponse, PamPlatformListResponse,
  PamCleanupSignalsResponse, PlatformCatalogsResponse, PlatformTargetListResponse, PsmConnectorTypeListResponse,
} from '../types/pam';

export function fetchPamComponents(options?: RequestInit): Promise<PamComponentListResponse> {
  return api<PamComponentListResponse>('/cmdb/pam-components', options);
}

export function fetchPamCleanupSignals(options?: RequestInit): Promise<PamCleanupSignalsResponse> {
  return api<PamCleanupSignalsResponse>('/cmdb/pam-cleanup-signals', options);
}

export function fetchPlatformCatalogs(options?: RequestInit): Promise<PlatformCatalogsResponse> {
  return api<PlatformCatalogsResponse>('/cmdb/pam-platform-catalogs', options);
}

export function fetchPamPlatforms(search: string, limit = 100, offset = 0, options?: RequestInit): Promise<PamPlatformListResponse> {
  return api<PamPlatformListResponse>(`/cmdb/pam-platforms?limit=${limit}&offset=${offset}&q=${encodeURIComponent(search)}`, options);
}

export function fetchPamConnectors(search: string, limit = 100, offset = 0, options?: RequestInit): Promise<PamConnectorListResponse> {
  return api<PamConnectorListResponse>(`/cmdb/pam-connectors?limit=${limit}&offset=${offset}&q=${encodeURIComponent(search)}`, options);
}

export function fetchPlatformTargets(search: string, limit = 100, offset = 0, options?: RequestInit): Promise<PlatformTargetListResponse> {
  return api<PlatformTargetListResponse>(`/cmdb/pam-platform-targets?limit=${limit}&offset=${offset}&q=${encodeURIComponent(search)}`, options);
}

export function fetchPsmConnectorTypes(search: string, limit = 100, offset = 0, options?: RequestInit): Promise<PsmConnectorTypeListResponse> {
  return api<PsmConnectorTypeListResponse>(`/cmdb/pam-psm-connector-types?limit=${limit}&offset=${offset}&q=${encodeURIComponent(search)}`, options);
}
