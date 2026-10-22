import { api } from '../../../cross/lib/api';

export async function createBusinessUnit(payload: { unit_code: string; unit_name: string }): Promise<void> {
  await api('/business-units', { method: 'POST', body: JSON.stringify(payload) });
}

export async function createResponsible(payload: { display_name: string; email: string }): Promise<void> {
  await api('/responsibles', { method: 'POST', body: JSON.stringify(payload) });
}
