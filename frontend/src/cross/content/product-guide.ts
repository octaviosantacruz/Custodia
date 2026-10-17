import type { WorkspaceView } from '../lib/workspaces.ts';
import type { GuideSectionId } from './guide-sections.ts';

/* DOCS-PORTAL-001: publishable product guide, curated and versioned with the
   frontend. It is plain typed data -- never Markdown read from the filesystem,
   never dangerouslySetInnerHTML -- and only describes capabilities already
   present in the workspace catalog and the integration contracts. Internal
   docs/ decisions stay out of the shipped artifact. */

export type GuideBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'steps'; items: readonly string[] }
  | { kind: 'bullets'; items: readonly string[] }
  | { kind: 'note'; text: string }
  | { kind: 'api-reference'; enabledText: string; disabledText: string };

export type GuideLink = { view: WorkspaceView; label: string };

export type GuideSectionContent = {
  blocks: readonly GuideBlock[];
  links?: readonly GuideLink[];
};

const EMAIL_RULE = 'El vínculo de personas usa igualdad exacta del correo normalizado, 1 a 1. Nunca por nombre, prefijo o similitud.';

export const GUIDE_CONTENT: Record<GuideSectionId, GuideSectionContent> = {
  'primeros-pasos': {
    blocks: [
      { kind: 'paragraph', text: 'Custodia es un inventario operativo (CMDB) para CyberArk y Netskope. Reúne lo que cada plataforma reporta, lo mantiene separado por origen y te deja clasificar y revisar sin mezclar herramientas.' },
      { kind: 'steps', items: [
        'Elegí una plataforma en Inicio o usá el selector de herramientas del encabezado.',
        'Dentro de una plataforma, el selector de vistas permite cambiar de sección.',
        'Abrí Command-K con Ctrl+K (⌘+K en Mac) para buscar vistas, acciones, widgets e inventario.',
      ] },
      { kind: 'paragraph', text: 'Conexiones es la herramienta transversal para ver el alcance de cada persona en las herramientas. En Personas podés revisar los registros relacionados y la evidencia del cliente Netskope de la persona elegida. La administración de Custodia (usuarios, permisos y actividad) vive aparte, en Administración.' },
      { kind: 'note', text: 'BigID DSPM figura como Próximamente: no está integrado y no muestra inventario propio. Los conteos que ves salen de la última corrida de cada fuente, no de valores fijos.' },
    ],
    links: [
      { view: 'general', label: 'Abrir Métricas CyberArk' },
      { view: 'safes', label: 'Abrir Safes' },
      { view: 'person', label: 'Abrir Personas' },
      { view: 'netskope', label: 'Abrir Métricas Netskope' },
    ],
  },
  personas: {
    blocks: [
      { kind: 'paragraph', text: 'Personas cruza las herramientas para una misma persona. El punto de partida es el correo: se elige una dirección y Custodia muestra en qué herramientas aparece y con qué vínculo. En el panel Netskope podés abrir la evidencia del cliente de la persona elegida, con su estado, dispositivos recientes y corridas de origen.' },
      { kind: 'bullets', items: [
        'Vínculo por correo: coincidencia exacta 1 a 1, en ambos sentidos.',
        'Referencia por nombre: SIA menciona al usuario PAM por nombre; la UI la marca como no confirmada y nunca ofrece un enlace.',
        'Ambiguo: más de un candidato activo comparte el correo; no se dibuja el vínculo.',
        'Sin registro: la persona no aparece en esa herramienta; no se inventan datos.',
      ] },
      { kind: 'paragraph', text: EMAIL_RULE },
      { kind: 'note', text: 'La cobertura por persona requiere lectura de Identity Administration y Netskope. Con permiso de una sola de esas fuentes no se solicitan ni se muestran conteos de cobertura.' },
      { kind: 'paragraph', text: 'La vista jerarquiza las herramientas: CyberArk PAM como rama principal con Identity Administration y SIA como sus herramientas, y Netskope como segunda rama. Esa jerarquía es visual: cada vínculo conserva su procedencia real y no implica una relación nueva entre PAM, Identity o SIA.' },
      { kind: 'paragraph', text: 'Podés abrir el detalle de cada herramienta desde su panel. Las herramientas que tus permisos no alcanzan no se muestran.' },
    ],
    links: [
      { view: 'person', label: 'Abrir Personas' },
      { view: 'graph', label: 'Abrir Acceso' },
      { view: 'netskopePosture', label: 'Abrir Postura Netskope' },
      { view: 'netskopeInventory', label: 'Abrir Inventario' },
    ],
  },
  'cyberark-pam': {
    blocks: [
      { kind: 'paragraph', text: 'PAM es la cadena verificada de CyberArk Privilege Cloud: usuarios, roles, Safes, plataformas y conectores PSM. El inventario se sincroniza por corridas y conserva el historial de cada Safe.' },
      { kind: 'bullets', items: [
        'Safes: inventario con miembros, cuentas y metadatos técnicos; la búsqueda y los filtros se mantienen al paginar.',
        'Los miembros de un Safe son relaciones de permiso (User/Group). No representan licencias ni cantidad de usuarios habilitados.',
        'Cuentas: nombre, usuario, dirección y plataforma. Custodia nunca persiste ni exporta contraseñas, secretos ni atributos de credencial.',
        'Plataformas y Conectores: catálogos técnicos con sus Safes, cuentas y componentes PSM.',
        'Postura: pestaña Riesgos con las señales verificables del inventario que requieren revisión o seguimiento, y pestaña Depuración con las señales de limpieza (solo lectura).',
      ] },
      { kind: 'paragraph', text: 'La frescura del inventario se muestra como antigüedad reportada por CyberArk. Custodia no publica KPIs de rotación de credenciales: requieren una decisión de producto y un contrato de datos específico.' },
    ],
    links: [
      { view: 'safes', label: 'Abrir Safes' },
      { view: 'posture', label: 'Abrir Postura' },
      { view: 'graph', label: 'Abrir Acceso' },
      { view: 'platforms', label: 'Abrir Plataformas' },
      { view: 'pamHealth', label: 'Abrir Servicio' },
    ],
  },
  'cyberark-identity': {
    blocks: [
      { kind: 'paragraph', text: 'Identidades tiene dos vistas: Usuarios y Roles y grupos. Los roles de CyberArk y grupos de Okta se distinguen con etiquetas; al expandirlos se pueden recorrer los miembros directos y las capas anidadas. El directorio se sincroniza desde Identity Administration.' },
      { kind: 'paragraph', text: 'El puente sancionado hacia PAM sólo existe por identificador exacto (el UUID de CyberArk Identity compartido) o por correo exacto 1 a 1. Los roles de Identity no se puentean con los roles PAM: no comparten identificadores.' },
      { kind: 'note', text: 'Cobertura parcial y explícita: cuando no hay equivalencia en la cadena PAM, el detalle lo dice en lugar de inferirla.' },
    ],
    links: [
      { view: 'identity', label: 'Abrir Identidades' },
      { view: 'identityRoles', label: 'Abrir Roles y grupos' },
      { view: 'graph', label: 'Abrir Acceso' },
    ],
  },
  'cyberark-sia': {
    blocks: [
      { kind: 'paragraph', text: 'SIA (Secure Infrastructure Access) administra políticas de acceso, recursos y cuentas fuertes de base de datos. Sus objetos se sincronizan como fuente independiente de PAM.' },
      { kind: 'bullets', items: [
        'Políticas: estado, plataformas y reglas tal como las reporta SIA.',
        'Recursos: máquinas virtuales descubiertas y su proveedor de descubrimiento.',
        'Cuentas fuertes de bases de datos: motor, puerto, base y fechas reportadas.',
      ] },
      { kind: 'paragraph', text: 'SIA no expone el UUID en sus grantees: en Personas su vínculo con una persona es una referencia por nombre, siempre señalada como no confirmada.' },
    ],
    links: [
      { view: 'sia', label: 'Abrir SIA' },
      { view: 'assets', label: 'Abrir Cobertura' },
    ],
  },
  'cyberark-access': {
    blocks: [
      { kind: 'paragraph', text: 'El Access space de CyberArk se sigue sincronizando como fuente independiente, pero su catálogo de activos ya no tiene una vista propia en Custodia.' },
      { kind: 'note', text: 'La relación con plataformas PAM no se infiere por nombre ni por similitud; si no hay ID exacto, no se dibuja.' },
    ],
    links: [],
  },
  netskope: {
    blocks: [
      { kind: 'paragraph', text: 'Netskope reúne el inventario de equipos y usuarios, señales sobre el estado de los equipos y conteos de alertas. Cada vista responde a una pregunta distinta y mantiene su información separada.' },
      { kind: 'bullets', items: [
        'Métricas: conteos agrupados de alertas y estado general del inventario; no muestra cada alerta.',
        'Postura: «qué está mal y qué hago». Arriba, los totales por severidad; abajo, una sola tabla con todos los chequeos (cliente desinstalado o desactualizado, SO debajo del mínimo, equipos sin señal, hostnames duplicados y, con su permiso, confianza del usuario baja). Un chequeo sin línea base figura como no evaluado, nunca como cero. Cada fila se expande con una muestra y su detalle: el último evento del cliente, los equipos sin señal agrupados por lo que explica Netskope y los grupos duplicados. ?open=<chequeo> abre esa fila.',
        'Equipos: «cómo está la flota». Una banda con lo crítico (activos, señal en 24 h, cliente al día, desinstalación, sin eventos hace más de 30 días, cambios) y dos pestañas: Flota, una tabla agrupada por empresa, SO, client config o fabricante, y Cambios entre las dos últimas sincronizaciones. Los números de riesgo de la banda abren su fila en Postura.',
        'Inventario: consultá los equipos, su usuario y su última señal; al abrir una fila ves el rendimiento digital del equipo (ADEM) y las anomalías del usuario, con un enlace a su ficha. Desde Personas se abre esta misma tabla filtrada por usuario.',
        'Usuarios: «Para revisar» combina confianza baja o moderada con los 100 menores puntajes de rendimiento digital informados por Netskope (últimas 24 h); muestra hasta 50 personas, sin representar a todo el tenant ni confirmar una falla. «Por empresa» compara cantidades, proporciones y cambios de riesgo. La búsqueda superior y cada fila abren una ficha con índice de confianza (0–1000, menor significa mayor riesgo), rendimiento digital (0–100, mayor es mejor), anomalías y una sola tabla de equipos. Equipo, red y aplicaciones son componentes del rendimiento; el menor puntaje no confirma la causa. Los equipos se unen por nombre exacto y único; sin coincidencia, cada fuente mantiene su fila con Sin dato. El POP informado por ADEM no indica latencia, ubicación personal, egreso, cobertura ni ruta de red.',
        'Administradores (con el permiso para administradores y roles de Netskope): las cuentas con acceso administrativo al tenant, su rol, estado, último acceso y MFA, y por cada rol los grupos de API que abre con su nivel (lectura, escritura o administración) y las páginas de la consola correspondientes. «Activos sin rol» y «Cuentas de servicio» filtran la tabla. No incluye credenciales ni quién creó o editó un rol.',
        'Anomalías por usuario (UEBA, últimos 30 días): conteos por severidad y las más graves y recientes, sin direcciones IP ni identificadores. Requiere el permiso para confianza y anomalías de usuarios; sin él el bloque no aparece.',
        'La columna «En oficina» de la Flota: Netskope clasifica cada equipo como en oficina o fuera de oficina con su On-Premises Detection; Custodia no compara direcciones ni guarda IPs. Un equipo cuyo dato todavía no se sincronizó figura como Sin dato, nunca como remoto.',
        'Riesgo por empresa (en Usuarios, mismo permiso de confianza y anomalías de usuarios): proporción de usuarios activos con confianza baja o moderada por empresa y su variación semanal; es una proporción, no un promedio. El botón «Ver usuarios con señales de riesgo» abre la lista completa: los usuarios activos con índice bajo o moderado y su variación contra hace una semana. Requiere un permiso específico; una cuenta ausente puede tener confianza buena o no haber estado activa; no confirma ausencia de riesgo.',
      ] },
      { kind: 'paragraph', text: 'Índice de confianza del usuario (UCI, User Confidence Index): Netskope resume las señales de riesgo observadas en la actividad de una cuenta en un puntaje de 0 a 1000. Menor puntaje significa mayor riesgo. Es una señal para investigar, no una confirmación de compromiso. La lista «Usuarios con señales de riesgo» incluye sólo confianza baja o moderada. En la variación semanal, Mejora indica que el puntaje subió y Empeora que bajó; Sin dato significa que falta la lectura anterior.' },
      { kind: 'paragraph', text: 'Cómo leer los indicadores del tablero:' },
      { kind: 'bullets', items: [
        'Usuarios con actividad reciente: cada identidad se cuenta una vez si tiene al menos un dispositivo vinculado por ID o correo exacto que reportó un evento en el período elegido. El porcentaje usa todas las identidades del inventario como denominador. No equivale al conteo de nombres de usuario de la consola y no demuestra que una persona haya iniciado sesión o usado el equipo.',
        'Usuarios en inventario y «Diferencia frente a Netskope»: la tarjeta compara con el «Total Users» de la consola de Netskope. Esa cifra cuenta filas, no identidades distintas: la API de usuarios devuelve a algunos usuarios dos veces al paginar (mismo id y mismo contenido) y la consola los suma dos veces; Custodia los une por id y cuenta cada identidad una vez. Ambos excluyen a quien tiene todas sus cuentas borradas. Si la última sincronización guardó cuántas filas llegaron repetidas, ese número explica la diferencia; si no lo guardó, no se puede conciliar con exactitud.',
        'Diferencias esperadas frente a la consola: en dispositivos pueden ser unos pocos equipos (un equipo que apareció después del último sync, un evento fechado a más de 1 hora por delante del reloj, que se considera no confiable, y la ventana móvil de 7 días). En usuarios con actividad, unas pocas decenas: la consola cuenta nombres de usuario que aparecen en equipos con evento y Custodia cuenta identidades del inventario con al menos un equipo con evento. Los datos cambian con cada sincronización (cada 30 min), así que una cifra puede variar en uno o dos equipos entre consultas.',
        'Dispositivos con evento en 7 días: incluye cualquier tipo de último evento informado, incluso apagado, desinstalación o desconexión. Es actividad reportada por el cliente, no una conexión en vivo ni una medida de uso humano.',
        'Equipos sin señal hace más de 30 días: cuenta dispositivos activos cuyo último evento válido supera ese corte. La antigüedad por sí sola no confirma abandono ni autoriza una baja.',
        'Alertas agregadas: son conteos por período y dimensión. El total puede incluir tipos de alerta distintos de DLP y las distribuciones no se deben sumar entre sí; no representan una lista de incidentes individuales.',
        'Sin dato, no calculable y captura ausente no significan cero. El detalle de cada indicador identifica su población, período, filtros y actualización.',
      ] },
      { kind: 'note', text: 'No se infieren relaciones entre fuentes: un usuario de Netskope no se resuelve contra CyberArk desde estas vistas.' },
    ],
    links: [
      { view: 'netskope', label: 'Abrir Métricas Netskope' },
      { view: 'netskopePosture', label: 'Abrir Postura Netskope' },
      { view: 'netskopeOperations', label: 'Abrir Equipos' },
      { view: 'netskopeInventory', label: 'Abrir Inventario' },
      { view: 'netskopeDemSites', label: 'Abrir Usuarios' },
      { view: 'netskopeAdmins', label: 'Abrir Administradores' },
    ],
  },
  tableros: {
    blocks: [
      { kind: 'paragraph', text: 'Cada plataforma tiene una vista de métricas personalizable. Los widgets muestran conteos o gráficos del inventario.' },
      { kind: 'bullets', items: [
        'Se agregan, quitan, reordenan y redimensionan desde la propia vista.',
        'Los presets sugeridos sólo reemplazan la vista guardada después de una confirmación explícita.',
        'La configuración se guarda por persona; una corrida de datos nueva no reordena ni borra el tablero.',
      ] },
      { kind: 'note', text: 'Buscar un widget desde Command-K sólo navega a su tablero: nunca agrega, quita ni reordena widgets ni guarda preferencias.' },
    ],
    links: [
      { view: 'general', label: 'Abrir Métricas CyberArk' },
      { view: 'netskope', label: 'Abrir Métricas Netskope' },
    ],
  },
  administracion: {
    blocks: [
      { kind: 'paragraph', text: 'El acceso se resuelve con el catálogo de permisos: roles de plataforma, roles por herramienta (PAM, Identity, SIA, Netskope) y roles compuestos que combinan niveles por dominio.' },
      { kind: 'bullets', items: [
        'Cada ruta valida sus permisos en el servidor; la UI sólo oculta lo que no podés abrir.',
        'Usuarios y permisos permite administrar cuentas y roles; en modo híbrido conviven el ingreso local y OIDC.',
        'Actividad es la bitácora administrativa: quién cambió qué y cuándo.',
        'Las exportaciones CSV requieren permiso de exportación, quedan auditadas y neutralizan fórmulas de planilla.',
      ] },
      { kind: 'paragraph', text: 'Roles y permisos agrupa los perfiles y capacidades en compartimientos por herramienta. Cada compartimiento se puede plegar; los perfiles transversales aparecen una sola vez. Abrí un rol o una celda para consultar sus capacidades, acciones y alcance. «Miembros» muestra las cuentas que lo tienen; desde ahí se agrega o se quita una asignación directa.' },
      { kind: 'bullets', items: [
        'Un rol que llega por un grupo de Okta se cambia en Okta: no se puede quitar desde Custodia. Los asignados en Custodia conviven con los de Okta y ningún login los quita.',
        'Nadie cambia sus propios roles ni asigna un rol con permisos que no tiene; Custodia nunca queda sin administrador.',
        'Al crear un rol podés elegir capacidades concretas o niveles vinculados. Un rol compuesto elige un nivel por área; un área sin participación no aporta permisos, aunque otro nivel elegido puede dar acceso a esa herramienta.',
        'Los roles del sistema no se editan: se duplican como personalizados.',
        '«Por usuario» marca accesos a datos de personas (alertas DLP, confianza y anomalías de usuarios de Netskope).',
      ] },
      { kind: 'note', text: 'hybrid habilita login local y OIDC a la vez; no debe leerse como un despliegue OIDC endurecido.' },
    ],
    links: [
      { view: 'users', label: 'Abrir Usuarios y permisos' },
      { view: 'activity', label: 'Abrir Actividad' },
    ],
  },
  'casos-de-uso': {
    blocks: [
      { kind: 'steps', items: [
        '¿Quién es esta persona y dónde aparece? Buscala en Personas por correo y revisá el estado de cada herramienta antes de abrir su cadena.',
        '¿Hay Safes sin cuentas o sin clasificar? Abrí Safes, filtrá por salud o clasificación y clasificá desde el detalle.',
        '¿Está cubierta una conexión migrada? Abrí Cobertura y contrastá el activo con PAM y SIA.',
        '¿Cómo actualizo el inventario de destinos? En Cobertura, Importar CSV: la clave es IP y puerto, ves cuántos son nuevos, cambian o faltan antes de aplicar. Lo que falta pasa a Retirado, no se borra; Reemplazar todo deja exactamente el archivo. Exportar CSV baja los destinos activos y se puede volver a importar sin diferencias. Para corregir un valor, hacé clic en su marca (Platform, DBA, ZSP, Acceso) o seleccioná varias filas y aplicá un valor a todas. Cada destino tiene un estado de trabajo (Pendiente, En curso, Incorporado, Bloqueado, No aplica), un responsable y una nota; el detalle muestra su historial. Un import no los pisa salvo que el CSV traiga esas columnas. La pestaña Avance muestra «X de N» por capacidad y por ambiente, y la evolución semanal.',
        '¿Qué equipos están atrasados o tienen un cliente desactualizado? Abrí Equipos y priorizá por actividad y cumplimiento.',
        '¿Quién cambió este permiso? Abrí Actividad y filtrá por actor o entidad.',
      ] },
    ],
    links: [
      { view: 'person', label: 'Abrir Personas' },
      { view: 'safes', label: 'Abrir Safes' },
      { view: 'assets', label: 'Abrir Cobertura' },
      { view: 'netskopePosture', label: 'Abrir Postura Netskope' },
      { view: 'netskopeOperations', label: 'Abrir Equipos' },
      { view: 'activity', label: 'Abrir Actividad' },
    ],
  },
  datos: {
    blocks: [
      { kind: 'bullets', items: [
        'Cada fila pertenece a una sola fuente (source_system); una sincronización nunca reconcilia objetos de otra plataforma.',
        'Los registros ausentes sólo se marcan retirados tras una corrida completa y exitosa; una respuesta parcial no retira nada.',
        'El trabajo humano (unidad, responsable, estado, próxima acción) nunca se sobrescribe desde una sincronización.',
        'Las personas se vinculan por correo exacto 1 a 1; el correo técnico del tenant queda excluido.',
      ] },
      { kind: 'paragraph', text: 'Frescura no es rotación: mostrar la antigüedad reportada no equivale a saber cuándo rotó una credencial. Esa métrica no está implementada y no se estima desde otros campos.' },
      { kind: 'note', text: 'Excluir Safes internos de las métricas de negocio requiere una clasificación explícita; no se deduce del nombre.' },
    ],
    links: [
      { view: 'general', label: 'Abrir Métricas CyberArk' },
      { view: 'posture', label: 'Abrir Postura' },
    ],
  },
  api: {
    blocks: [
      { kind: 'paragraph', text: 'Custodia publica su contrato HTTP como referencia técnica. La guía de producto y la referencia de API son superficies distintas: la referencia se abre como documentación interactiva de los endpoints reales.' },
      { kind: 'api-reference',
        enabledText: 'La referencia interactiva está disponible en este despliegue. Se abre en una pestaña nueva.',
        disabledText: 'Este despliegue mantiene la referencia técnica fuera de exposición directa. La guía sigue disponible; consultá con el equipo de plataforma si necesitás el contrato o un token de lectura.' },
      { kind: 'bullets', items: [
        'Un token personal de la sesión autenticada habilita sólo lectura con Authorization: Bearer.',
        'Las escrituras de automatización usan el token de aplicación y el encabezado X-Access-Token; ese camino no otorga lectura.',
        'Las operaciones reales, sus permisos y sus campos son los que publica el contrato; esta guía no agrega endpoints ni capacidades.',
      ] },
    ],
  },
};
