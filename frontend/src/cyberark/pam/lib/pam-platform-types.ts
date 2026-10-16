/* UX-QA-005: CyberArk's `systemType` values as the tenant reports them
   (2026-10-10). Unknown values keep their original text. */
const PLATFORM_TYPE_LABELS: Record<string, string> = {
  'Database': 'Base de datos',
  'Website': 'Sitio web',
  'Windows': 'Windows',
  '*NIX': 'Unix / Linux',
  'Cloud Service': 'Servicio en la nube',
  'Operating System': 'Sistema operativo',
  'Amazon web services': 'Amazon Web Services',
  'Application': 'Aplicación',
  'Directory': 'Directorio',
  'Imported Platforms': 'Plataformas importadas',
  'Misc': 'Otros',
  'Security Appliance': 'Equipo de seguridad',
  'PSM Secure Connect': 'PSM Secure Connect',
  'Network Device': 'Dispositivo de red',
};

/** Spanish label for the platform type, or the raw CyberArk value when it is not mapped. */
export function platformTypeLabel(systemType: string | null | undefined): { label: string; raw: string | null } {
  const raw = (systemType ?? '').trim();
  if (!raw) return { label: 'Sin tipo', raw: null };
  return { label: PLATFORM_TYPE_LABELS[raw] ?? raw, raw };
}
