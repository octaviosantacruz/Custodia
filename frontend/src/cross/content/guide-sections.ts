/* DOCS-PORTAL-001: editorial index of the product guide. Kept free of prose so
   Command-K and the unit tests can import it into the entry bundle; the
   publishable content lives in `product-guide.ts`, loaded only with the lazy
   help workspace. No Markdown is read at runtime and no HTML is injected. */

export type GuideSectionId =
  | 'primeros-pasos'
  | 'personas'
  | 'cyberark-pam'
  | 'cyberark-identity'
  | 'cyberark-sia'
  | 'cyberark-access'
  | 'netskope'
  | 'tableros'
  | 'administracion'
  | 'casos-de-uso'
  | 'datos'
  | 'api';

export type GuideGroupId = 'general' | 'cyberark' | 'netskope' | 'dshub';

export type GuideSectionMeta = {
  id: GuideSectionId;
  group: GuideGroupId;
  title: string;
  summary: string;
  /* Owner and update rule per section (tracker requirement: no orphan docs). */
  owner: string;
  updateRule: string;
  aliases: readonly string[];
  priority: number;
};

export const GUIDE_GROUP_LABELS: Record<GuideGroupId, string> = {
  general: 'General',
  cyberark: 'CyberArk',
  netskope: 'Netskope',
  dshub: 'DS Hub',
};

/* Canonical editorial order shared by the side navigation and Command-K. */
export const GUIDE_SECTIONS: readonly GuideSectionMeta[] = [
  {
    id: 'primeros-pasos', group: 'general', title: 'Primeros pasos',
    summary: 'Qué es DS Hub, cómo moverte entre herramientas y de dónde salen los datos que ves.',
    owner: 'Equipo de producto DS Hub',
    updateRule: 'Revisar al cambiar el Inicio, la navegación o el flujo de sincronización.',
    aliases: ['inicio', 'empezar', 'introduccion', 'overview'], priority: 50,
  },
  {
    id: 'personas', group: 'dshub', title: 'Personas',
    summary: 'Buscá una persona, sus registros relacionados y la cobertura disponible dentro de Personas.',
    owner: 'Equipo de producto DS Hub',
    updateRule: 'Revisar si cambia el vínculo por correo, los estados de vínculo o la vista por persona.',
    aliases: ['conexiones', 'persona', 'vinculo', 'correo', 'people', 'cobertura por persona'], priority: 51,
  },
  {
    id: 'cyberark-pam', group: 'cyberark', title: 'CyberArk PAM',
    summary: 'Safes, miembros, cuentas, plataformas, PSM y señales de salud del inventario PAM.',
    owner: 'Equipo de operaciones PAM',
    updateRule: 'Revisar al cambiar el catálogo de Safes, sus métricas o la ingesta PAM.',
    aliases: ['pam', 'safes', 'bovedas', 'cuentas', 'cpm', 'psm'], priority: 52,
  },
  {
    id: 'cyberark-identity', group: 'cyberark', title: 'Identity Administration',
    summary: 'Usuarios y grupos de Identity Administration, junto con los roles PAM en vistas separadas.',
    owner: 'Equipo de operaciones PAM',
    updateRule: 'Revisar si cambia el contrato SCIM o la resolución de federaciones.',
    aliases: ['identity', 'scim', 'okta', 'federaciones'], priority: 53,
  },
  {
    id: 'cyberark-sia', group: 'cyberark', title: 'SIA',
    summary: 'Políticas de acceso, máquinas virtuales y cuentas de base de datos administradas por SIA.',
    owner: 'Equipo de operaciones PAM',
    updateRule: 'Revisar si cambia el contrato de políticas, recursos o cuentas fuertes.',
    aliases: ['sia', 'politicas', 'strong accounts', 'iap'], priority: 54,
  },
  {
    id: 'cyberark-access', group: 'cyberark', title: 'Access',
    summary: 'Catálogo de activos del Access space y su relación con plataformas PAM.',
    owner: 'Equipo de operaciones PAM',
    updateRule: 'Revisar si cambia el catálogo de assets o su relación por ID exacto.',
    aliases: ['access space', 'assets'], priority: 55,
  },
  {
    id: 'netskope', group: 'netskope', title: 'Netskope',
    summary: 'Inventario de equipos y usuarios, estado de dispositivos y alertas DLP agregadas.',
    owner: 'Equipo de operaciones Netskope',
    updateRule: 'Revisar al cambiar la ingesta Netskope, la postura o la ventana DLP.',
    aliases: ['netskope', 'dlp', 'sse', 'dispositivos'], priority: 56,
  },
  {
    id: 'tableros', group: 'dshub', title: 'Tableros y widgets',
    summary: 'Los tableros personales de PAM y Netskope: qué muestran y cómo se editan.',
    owner: 'Equipo de producto DS Hub',
    updateRule: 'Revisar al agregar, quitar o cambiar widgets y presets registrados.',
    aliases: ['widgets', 'dashboard', 'metricas', 'tablero'], priority: 57,
  },
  {
    id: 'administracion', group: 'dshub', title: 'Administración y permisos',
    summary: 'Roles, permisos efectivos, auditoría local y autenticación local/OIDC.',
    owner: 'Equipo de plataforma DS Hub',
    updateRule: 'Revisar al cambiar el catálogo de permisos, roles o el modo de autenticación.',
    aliases: ['roles', 'permisos', 'usuarios', 'auditoria', 'oidc'], priority: 58,
  },
  {
    id: 'casos-de-uso', group: 'dshub', title: 'Casos de uso',
    summary: 'Recorridos concretos para las preguntas operativas más frecuentes.',
    owner: 'Equipo de producto DS Hub',
    updateRule: 'Revisar cuando cambien los flujos principales o se sumen capacidades.',
    aliases: ['use cases', 'recorridos', 'ejemplos'], priority: 59,
  },
  {
    id: 'datos', group: 'dshub', title: 'Significado y frescura de datos',
    summary: 'Qué significa cada estado, qué es frescura y qué no está implementado.',
    owner: 'Equipo de plataforma DS Hub',
    updateRule: 'Revisar ante cualquier cambio de contrato de datos o de semántica.',
    aliases: ['frescura', 'rotacion', 'procedencia', 'source system', 'estados'], priority: 60,
  },
  {
    id: 'api', group: 'dshub', title: 'API para desarrolladores',
    summary: 'La referencia técnica de la API de DS Hub y cómo autenticarse.',
    owner: 'Equipo de plataforma DS Hub',
    updateRule: 'Revisar si cambia la exposición de la referencia o el contrato de tokens.',
    aliases: ['openapi', 'scalar', 'referencia', 'tokens'], priority: 61,
  },
];

export const DEFAULT_GUIDE_SECTION: GuideSectionId = GUIDE_SECTIONS[0].id;

export function guideSection(id: string | null | undefined): GuideSectionMeta | undefined {
  return GUIDE_SECTIONS.find((section) => section.id === id);
}

/** Stable deep link for a section: `/help?section=<id>`. */
export function guideSectionPath(id: GuideSectionId): string {
  return `/help?section=${id}`;
}

/** Reads the section from a location search (unknown values fall back). */
export function guideSectionFromSearch(search: string): GuideSectionId {
  const requested = new URLSearchParams(search.startsWith('?') ? search : `?${search}`).get('section');
  return guideSection(requested)?.id ?? DEFAULT_GUIDE_SECTION;
}

/** DOCS-PORTAL-001: the /docs link only renders for an authenticated session
    in a deployment that exposes the reference. The signal never enables it. */
export function shouldShowApiReference(status: { authenticated?: boolean; api_docs_enabled?: boolean } | null | undefined): boolean {
  return Boolean(status?.authenticated && status.api_docs_enabled);
}
