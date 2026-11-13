import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../lib/api';
import { fetchDashboardTeamTemplates, publishDashboardTeamTemplate } from '../lib/dashboard-team-templates-api';
import { t } from '../i18n/index.ts';

export function useDashboardTeamTemplates<T>({ source, enabled, onUnauthorized, onError, onNotice }: {
  source: 'cyberark' | 'netskope'; enabled: boolean; onUnauthorized: () => void; onError: (message: string) => void; onNotice: (message: string) => void;
}) {
  const client = useQueryClient();
  const key = ['dashboard-team-templates', source] as const;
  const query = useQuery({ queryKey: key, enabled, queryFn: ({ signal }) => fetchDashboardTeamTemplates<T>(source, signal) });
  const mutation = useMutation({ mutationFn: ({ roleCode, widgets }: { roleCode: string; widgets: T[] }) => publishDashboardTeamTemplate(source, roleCode, widgets) });
  const publish = async (roleCode: string, widgets: T[]) => {
    try {
      const result = await mutation.mutateAsync({ roleCode, widgets });
      await client.invalidateQueries({ queryKey: key });
      onNotice(t('Vista publicada para {role_name} · versión {version}', { role_name: result.role_name, version: result.version }));
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onUnauthorized();
      else onError(error instanceof Error ? error.message : t('No se pudo publicar la vista de equipo'));
      return false;
    }
  };
  return { templates: query.data?.templates ?? [], loading: query.isLoading, publishing: mutation.isPending, publish };
}
