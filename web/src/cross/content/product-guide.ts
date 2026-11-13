import type { WorkspaceView } from '../lib/workspaces.ts';
import type { GuideSectionId } from './guide-sections.ts';
import { t } from '../i18n/index.ts';

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

const EMAIL_RULE = t('El vínculo de personas usa igualdad exacta del correo normalizado, 1 a 1. Nunca por nombre, prefijo o similitud.');

export const GUIDE_CONTENT: Record<GuideSectionId, GuideSectionContent> = {
  'primeros-pasos': {
    blocks: [
      { kind: 'paragraph', text: t('Custodia es un inventario operativo (CMDB) para CyberArk y Netskope. Reúne lo que cada plataforma reporta, lo mantiene separado por origen y te deja clasificar y revisar sin mezclar herramientas.') },
      { kind: 'steps', items: [
        t('Elegí una plataforma en Inicio o usá el selector de herramientas del encabezado.'),
        t('Dentro de una plataforma, el selector de vistas permite cambiar de sección.'),
        t('Abrí Command-K con Ctrl+K (⌘+K en Mac) para buscar vistas, acciones, widgets e inventario.'),
      ] },
      { kind: 'paragraph', text: t('Conexiones es la herramienta transversal para ver el alcance de cada persona en las herramientas. En Personas podés revisar los registros relacionados y la evidencia del cliente Netskope de la persona elegida. La administración de Custodia (usuarios, permisos y actividad) vive aparte, en Administración.') },
      { kind: 'note', text: t('BigID DSPM figura como Próximamente: no está integrado y no muestra inventario propio. Los conteos que ves salen de la última corrida de cada fuente, no de valores fijos.') },
    ],
    links: [
      { view: 'general', label: t('Abrir Métricas CyberArk') },
      { view: 'safes', label: t('Abrir Safes') },
      { view: 'person', label: t('Abrir Personas') },
      { view: 'netskope', label: t('Abrir Métricas Netskope') },
    ],
  },
  personas: {
    blocks: [
      { kind: 'paragraph', text: t('Personas cruza las herramientas para una misma persona. El punto de partida es el correo: se elige una dirección y Custodia muestra en qué herramientas aparece y con qué vínculo. En el panel Netskope podés abrir la evidencia del cliente de la persona elegida, con su estado, dispositivos recientes y corridas de origen.') },
      { kind: 'bullets', items: [
        t('Vínculo por correo: coincidencia exacta 1 a 1, en ambos sentidos.'),
        t('Referencia por nombre: SIA menciona al usuario PAM por nombre; la UI la marca como no confirmada y nunca ofrece un enlace.'),
        t('Ambiguo: más de un candidato activo comparte el correo; no se dibuja el vínculo.'),
        t('Sin registro: la persona no aparece en esa herramienta; no se inventan datos.'),
      ] },
      { kind: 'paragraph', text: EMAIL_RULE },
      { kind: 'note', text: t('La cobertura por persona requiere lectura de Identity Administration y Netskope. Con permiso de una sola de esas fuentes no se solicitan ni se muestran conteos de cobertura.') },
      { kind: 'paragraph', text: t('La vista jerarquiza las herramientas: CyberArk PAM como rama principal con Identity Administration y SIA como sus herramientas, y Netskope como segunda rama. Esa jerarquía es visual: cada vínculo conserva su procedencia real y no implica una relación nueva entre PAM, Identity o SIA.') },
      { kind: 'paragraph', text: t('Podés abrir el detalle de cada herramienta desde su panel. Las herramientas que tus permisos no alcanzan no se muestran.') },
    ],
    links: [
      { view: 'person', label: t('Abrir Personas') },
      { view: 'graph', label: t('Abrir Acceso') },
      { view: 'netskopePosture', label: t('Abrir Postura Netskope') },
      { view: 'netskopeInventory', label: t('Abrir Inventario') },
    ],
  },
  'cyberark-pam': {
    blocks: [
      { kind: 'paragraph', text: t('PAM es la cadena verificada de CyberArk Privilege Cloud: usuarios, roles, Safes, plataformas y conectores PSM. El inventario se sincroniza por corridas y conserva el historial de cada Safe.') },
      { kind: 'bullets', items: [
        t('Safes: inventario con miembros, cuentas y metadatos técnicos; la búsqueda y los filtros se mantienen al paginar.'),
        t('Los miembros de un Safe son relaciones de permiso (User/Group). No representan licencias ni cantidad de usuarios habilitados.'),
        t('Cuentas: nombre, usuario, dirección y plataforma. Custodia nunca persiste ni exporta contraseñas, secretos ni atributos de credencial.'),
        t('Plataformas y Conectores: catálogos técnicos de PAM y SIA. En Servicio → Conectores también se consultan los pools y redes de Connector Manager en vivo: nombres, fechas y conteos, sin valores de red ni identificadores. Los catálogos conservan sus fuentes; los conteos no miden salud ni capacidad.'),
        t('Postura: pestaña Riesgos con las señales verificables del inventario que requieren revisión o seguimiento, y pestaña Depuración con las señales de limpieza (solo lectura).'),
      ] },
      { kind: 'paragraph', text: t('La frescura del inventario se muestra como antigüedad reportada por CyberArk. Custodia no publica KPIs de rotación de credenciales: requieren una decisión de producto y un contrato de datos específico.') },
    ],
    links: [
      { view: 'safes', label: t('Abrir Safes') },
      { view: 'posture', label: t('Abrir Postura') },
      { view: 'graph', label: t('Abrir Acceso') },
      { view: 'platforms', label: t('Abrir Plataformas') },
      { view: 'pamHealth', label: t('Abrir Servicio') },
    ],
  },
  'cyberark-identity': {
    blocks: [
      { kind: 'paragraph', text: t('Identidades tiene dos vistas: Usuarios y Roles y grupos. Los roles de CyberArk y grupos de Okta se distinguen con etiquetas; al expandirlos se pueden recorrer los miembros directos y las capas anidadas. El directorio se sincroniza desde Identity Administration.') },
      { kind: 'paragraph', text: t('El puente sancionado hacia PAM sólo existe por identificador exacto (el UUID de CyberArk Identity compartido) o por correo exacto 1 a 1. Los roles de Identity no se puentean con los roles PAM: no comparten identificadores.') },
      { kind: 'note', text: t('Cobertura parcial y explícita: cuando no hay equivalencia en la cadena PAM, el detalle lo dice en lugar de inferirla.') },
    ],
    links: [
      { view: 'identity', label: t('Abrir Identidades') },
      { view: 'identityRoles', label: t('Abrir Roles y grupos') },
      { view: 'graph', label: t('Abrir Acceso') },
    ],
  },
  'cyberark-sia': {
    blocks: [
      { kind: 'paragraph', text: t('SIA (Secure Infrastructure Access) administra políticas de acceso, recursos y cuentas fuertes de base de datos. Sus objetos se sincronizan como fuente independiente de PAM.') },
      { kind: 'bullets', items: [
        t('Políticas: estado, plataformas y reglas tal como las reporta SIA.'),
        t('Recursos: máquinas virtuales descubiertas y su proveedor de descubrimiento.'),
        t('Cuentas fuertes de bases de datos: motor, puerto, base y fechas reportadas.'),
      ] },
      { kind: 'paragraph', text: t('SIA no expone el UUID en sus grantees: en Personas su vínculo con una persona es una referencia por nombre, siempre señalada como no confirmada.') },
    ],
    links: [
      { view: 'sia', label: t('Abrir SIA') },
      { view: 'assets', label: t('Abrir Cobertura') },
    ],
  },
  'cyberark-access': {
    blocks: [
      { kind: 'paragraph', text: t('El Access space de CyberArk se sigue sincronizando como fuente independiente, pero su catálogo de activos ya no tiene una vista propia en Custodia.') },
      { kind: 'note', text: t('La relación con plataformas PAM no se infiere por nombre ni por similitud; si no hay ID exacto, no se dibuja.') },
    ],
    links: [],
  },
  netskope: {
    blocks: [
      { kind: 'paragraph', text: t('Netskope reúne el inventario de equipos y usuarios, señales sobre el estado de los equipos y conteos de alertas. Cada vista responde a una pregunta distinta y mantiene su información separada.') },
      { kind: 'bullets', items: [
        t('Métricas: conteos agrupados de alertas y estado general del inventario; no muestra cada alerta.'),
        t('Postura: «qué está mal y qué hago». Arriba, los totales por severidad; abajo, una sola tabla con todos los chequeos (cliente desinstalado o desactualizado, SO debajo del mínimo, equipos sin señal, hostnames duplicados y, con su permiso, confianza del usuario baja). Un chequeo sin línea base figura como no evaluado, nunca como cero. Cada fila se expande con una muestra y su detalle: el último evento del cliente, los equipos sin señal agrupados por lo que explica Netskope y los grupos duplicados. ?open=<chequeo> abre esa fila.'),
        t('Equipos: «cómo está la flota». Una banda con lo crítico (activos, señal en 24 h, cliente al día, desinstalación, sin eventos hace más de 30 días, cambios) y dos pestañas: Flota, una tabla agrupada por empresa, SO, client config o fabricante, y Cambios entre las dos últimas sincronizaciones. Los números de riesgo de la banda abren su fila en Postura.'),
        t('Inventario: consultá los equipos, su usuario y su última señal; al abrir una fila ves el rendimiento digital del equipo (ADEM) y las anomalías del usuario, con un enlace a su ficha. Desde Personas se abre esta misma tabla filtrada por usuario.'),
        t('Riesgo: «Para revisar» lista hasta 50 personas con confianza baja o moderada, la menor primero; una señal de riesgo no confirma un incidente. «Por empresa» compara cantidades, proporciones y cambios de riesgo. La búsqueda superior y cada fila abren la ficha de la persona: índice de confianza (0–1000, menor significa mayor riesgo), sus últimos 7 días, anomalías y una sola tabla de equipos. Los equipos se unen por nombre exacto y único; sin coincidencia, cada fuente mantiene su fila con Sin dato.'),
        t('Administradores (con el permiso para administradores y roles de Netskope): las cuentas con acceso administrativo al tenant, su rol, estado, último acceso y MFA, y por cada rol los grupos de API que abre con su nivel (lectura, escritura o administración) y las páginas de la consola correspondientes. «Activos sin rol» y «Cuentas de servicio» filtran la tabla. No incluye credenciales ni quién creó o editó un rol.'),
        t('Anomalías por usuario (UEBA, últimos 30 días): conteos por severidad y las más graves y recientes, sin direcciones IP ni identificadores. Requiere el permiso para confianza y anomalías de usuarios; sin él el bloque no aparece.'),
        t('La columna «En oficina» de la Flota: Netskope clasifica cada equipo como en oficina o fuera de oficina con su On-Premises Detection; Custodia no compara direcciones ni guarda IPs. Un equipo cuyo dato todavía no se sincronizó figura como Sin dato, nunca como remoto.'),
        t('Rendimiento (permiso de confianza y anomalías de usuarios): cómo funcionan las apps y la red, con el puntaje ADEM de Netskope (0–100, mayor es mejor; equipo, red y aplicaciones son sus componentes y el menor no confirma la causa). «Oficina, por semana» mide solo los horarios en que el equipo de cada persona estuvo en la oficina y los compara con sus horarios remotos, por semana, día de la semana y empresa; se miden días completos hasta ayer, una semana sin medición no es cero y quien no tiene puntaje figura Sin dato. «Evolución diaria» muestra el promedio de cada día en la oficina y en remoto (cada persona pesa lo mismo), para todas las empresas o una, y puede superponer la línea de una persona; el período es de 30, 90 o 180 días o un rango «Desde/Hasta» (el mismo día en ambos muestra el rendimiento de esa fecha), y el resumen arriba del gráfico da el promedio del período. En el gráfico, un clic elige un día, arrastrar elige varios seguidos y Ctrl (⌘ en Mac) + clic suma o quita días sueltos; el resumen pasa a describir esos días; un punto hueco es un día con menos de 5 personas medidas y un día sin medición es un hueco. La ficha de cada persona muestra sus últimos 7 días: Oficina, Remoto, Sin señal (ningún equipo envió eventos) o Pendiente (el día todavía no se midió). El POP informado por ADEM no indica latencia, ubicación personal, egreso, cobertura ni ruta de red.'),
        t('Riesgo por empresa (en Riesgo, mismo permiso de confianza y anomalías de usuarios): proporción de usuarios activos con confianza baja o moderada por empresa y su variación semanal; es una proporción, no un promedio. El botón «Ver usuarios con señales de riesgo» abre la lista completa: los usuarios activos con índice bajo o moderado y su variación contra hace una semana. Requiere un permiso específico; una cuenta ausente puede tener confianza buena o no haber estado activa; no confirma ausencia de riesgo.'),
      ] },
      { kind: 'paragraph', text: t('Índice de confianza del usuario (UCI, User Confidence Index): Netskope resume las señales de riesgo observadas en la actividad de una cuenta en un puntaje de 0 a 1000. Menor puntaje significa mayor riesgo. Es una señal para investigar, no una confirmación de compromiso. La lista «Usuarios con señales de riesgo» incluye sólo confianza baja o moderada. En la variación semanal, Mejora indica que el puntaje subió y Empeora que bajó; Sin dato significa que falta la lectura anterior.') },
      { kind: 'paragraph', text: t('Cómo leer los indicadores del tablero:') },
      { kind: 'bullets', items: [
        t('Usuarios con actividad reciente: cada identidad se cuenta una vez si tiene al menos un dispositivo vinculado por ID o correo exacto que reportó un evento en el período elegido. El porcentaje usa todas las identidades del inventario como denominador. No equivale al conteo de nombres de usuario de la consola y no demuestra que una persona haya iniciado sesión o usado el equipo.'),
        t('Usuarios en inventario y «Diferencia frente a Netskope»: la tarjeta compara con el «Total Users» de la consola de Netskope. Esa cifra cuenta filas, no identidades distintas: la API de usuarios devuelve a algunos usuarios dos veces al paginar (mismo id y mismo contenido) y la consola los suma dos veces; Custodia los une por id y cuenta cada identidad una vez. Ambos excluyen a quien tiene todas sus cuentas borradas. Si la última sincronización guardó cuántas filas llegaron repetidas, ese número explica la diferencia; si no lo guardó, no se puede conciliar con exactitud.'),
        t('Diferencias esperadas frente a la consola: en dispositivos pueden ser unos pocos equipos (un equipo que apareció después del último sync, un evento fechado a más de 1 hora por delante del reloj, que se considera no confiable, y la ventana móvil de 7 días). En usuarios con actividad, unas pocas decenas: la consola cuenta nombres de usuario que aparecen en equipos con evento y Custodia cuenta identidades del inventario con al menos un equipo con evento. Los datos cambian con cada sincronización (cada 30 min), así que una cifra puede variar en uno o dos equipos entre consultas.'),
        t('Dispositivos con evento en 7 días: incluye cualquier tipo de último evento informado, incluso apagado, desinstalación o desconexión. Es actividad reportada por el cliente, no una conexión en vivo ni una medida de uso humano.'),
        t('Equipos sin señal hace más de 30 días: cuenta dispositivos activos cuyo último evento válido supera ese corte. La antigüedad por sí sola no confirma abandono ni autoriza una baja.'),
        t('Alertas agregadas: son conteos por período y dimensión. El total puede incluir tipos de alerta distintos de DLP y las distribuciones no se deben sumar entre sí; no representan una lista de incidentes individuales.'),
        t('Sin dato, no calculable y captura ausente no significan cero. El detalle de cada indicador identifica su población, período, filtros y actualización.'),
      ] },
      { kind: 'note', text: t('No se infieren relaciones entre fuentes: un usuario de Netskope no se resuelve contra CyberArk desde estas vistas.') },
    ],
    links: [
      { view: 'netskope', label: t('Abrir Métricas Netskope') },
      { view: 'netskopePosture', label: t('Abrir Postura Netskope') },
      { view: 'netskopeOperations', label: t('Abrir Equipos') },
      { view: 'netskopeInventory', label: t('Abrir Inventario') },
      { view: 'netskopeDemSites', label: t('Abrir Riesgo') },
      { view: 'netskopeOfficeExperience', label: t('Abrir Rendimiento') },
      { view: 'netskopeAdmins', label: t('Abrir Administradores') },
    ],
  },
  tableros: {
    blocks: [
      { kind: 'paragraph', text: t('Cada plataforma tiene una vista de métricas personalizable. Los widgets muestran conteos o gráficos del inventario.') },
      { kind: 'bullets', items: [
        t('Se agregan, quitan, reordenan y redimensionan desde la propia vista.'),
        t('Los presets sugeridos sólo reemplazan la vista guardada después de una confirmación explícita.'),
        t('La configuración se guarda por persona; una corrida de datos nueva no reordena ni borra el tablero.'),
      ] },
      { kind: 'note', text: t('Buscar un widget desde Command-K sólo navega a su tablero: nunca agrega, quita ni reordena widgets ni guarda preferencias.') },
    ],
    links: [
      { view: 'general', label: t('Abrir Métricas CyberArk') },
      { view: 'netskope', label: t('Abrir Métricas Netskope') },
    ],
  },
  administracion: {
    blocks: [
      { kind: 'paragraph', text: t('El acceso se resuelve con el catálogo de permisos: roles de plataforma, roles por herramienta (PAM, Identity, SIA, Netskope) y roles compuestos que combinan niveles por dominio.') },
      { kind: 'bullets', items: [
        t('Cada ruta valida sus permisos en el servidor; la UI sólo oculta lo que no podés abrir.'),
        t('Usuarios y permisos permite administrar cuentas y roles; en modo híbrido conviven el ingreso local y OIDC.'),
        t('Actividad es la bitácora administrativa: quién cambió qué y cuándo.'),
        t('Las exportaciones CSV requieren permiso de exportación, quedan auditadas y neutralizan fórmulas de planilla.'),
      ] },
      { kind: 'paragraph', text: t('Roles y permisos agrupa los perfiles y capacidades en compartimientos por herramienta. Cada compartimiento se puede plegar; los perfiles transversales aparecen una sola vez. Abrí un rol o una celda para consultar sus capacidades, acciones y alcance. «Miembros» muestra las cuentas que lo tienen; desde ahí se agrega o se quita una asignación directa.') },
      { kind: 'bullets', items: [
        t('Un rol que llega por un grupo de Okta se cambia en Okta: no se puede quitar desde Custodia. Los asignados en Custodia conviven con los de Okta y ningún login los quita.'),
        t('Nadie cambia sus propios roles ni asigna un rol con permisos que no tiene; Custodia nunca queda sin administrador.'),
        t('Al crear un rol podés elegir capacidades concretas o niveles vinculados. Un rol compuesto elige un nivel por área; un área sin participación no aporta permisos, aunque otro nivel elegido puede dar acceso a esa herramienta.'),
        t('Los roles del sistema no se editan: se duplican como personalizados.'),
        t('«Por usuario» marca accesos a datos de personas (alertas DLP, confianza y anomalías de usuarios de Netskope).'),
      ] },
      { kind: 'note', text: t('hybrid habilita login local y OIDC a la vez; no debe leerse como un despliegue OIDC endurecido.') },
    ],
    links: [
      { view: 'users', label: t('Abrir Usuarios y permisos') },
      { view: 'activity', label: t('Abrir Actividad') },
    ],
  },
  'casos-de-uso': {
    blocks: [
      { kind: 'steps', items: [
        t('¿Quién es esta persona y dónde aparece? Buscala en Personas por correo y revisá el estado de cada herramienta antes de abrir su cadena.'),
        t('¿Hay Safes sin cuentas o sin clasificar? Abrí Safes, filtrá por salud o clasificación y clasificá desde el detalle.'),
        t('¿Está cubierta una conexión migrada? Abrí Cobertura y contrastá el activo con PAM y SIA.'),
        t('¿Cómo actualizo el inventario de destinos? En Cobertura, Importar CSV: la clave es IP y puerto, ves cuántos son nuevos, cambian o faltan antes de aplicar. Lo que falta pasa a Retirado, no se borra; Reemplazar todo deja exactamente el archivo. Exportar CSV baja los destinos activos y se puede volver a importar sin diferencias. Para corregir un valor, hacé clic en su marca (Platform, DBA, ZSP, Acceso) o seleccioná varias filas y aplicá un valor a todas. Cada destino tiene un estado de trabajo (Pendiente, En curso, Incorporado, Bloqueado, No aplica), un responsable y una nota; el detalle muestra su historial. Un import no los pisa salvo que el CSV traiga esas columnas. La pestaña Avance muestra «X de N» por capacidad y por ambiente, y la evolución semanal.'),
        t('¿Qué equipos están atrasados o tienen un cliente desactualizado? Abrí Equipos y priorizá por actividad y cumplimiento.'),
        t('¿Quién cambió este permiso? Abrí Actividad y filtrá por actor o entidad.'),
      ] },
    ],
    links: [
      { view: 'person', label: t('Abrir Personas') },
      { view: 'safes', label: t('Abrir Safes') },
      { view: 'assets', label: t('Abrir Cobertura') },
      { view: 'netskopePosture', label: t('Abrir Postura Netskope') },
      { view: 'netskopeOperations', label: t('Abrir Equipos') },
      { view: 'activity', label: t('Abrir Actividad') },
    ],
  },
  datos: {
    blocks: [
      { kind: 'bullets', items: [
        t('Cada fila pertenece a una sola fuente (source_system); una sincronización nunca reconcilia objetos de otra plataforma.'),
        t('Los registros ausentes sólo se marcan retirados tras una corrida completa y exitosa; una respuesta parcial no retira nada.'),
        t('El trabajo humano (unidad, responsable, estado, próxima acción) nunca se sobrescribe desde una sincronización.'),
        t('Las personas se vinculan por correo exacto 1 a 1; el correo técnico del tenant queda excluido.'),
      ] },
      { kind: 'paragraph', text: t('Frescura no es rotación: mostrar la antigüedad reportada no equivale a saber cuándo rotó una credencial. Esa métrica no está implementada y no se estima desde otros campos.') },
      { kind: 'note', text: t('Excluir Safes internos de las métricas de negocio requiere una clasificación explícita; no se deduce del nombre.') },
    ],
    links: [
      { view: 'general', label: t('Abrir Métricas CyberArk') },
      { view: 'posture', label: t('Abrir Postura') },
    ],
  },
  api: {
    blocks: [
      { kind: 'paragraph', text: t('Custodia publica su contrato HTTP como referencia técnica. La guía de producto y la referencia de API son superficies distintas: la referencia se abre como documentación interactiva de los endpoints reales.') },
      { kind: 'api-reference',
        enabledText: t('La referencia interactiva está disponible en este despliegue. Se abre en una pestaña nueva.'),
        disabledText: t('Este despliegue mantiene la referencia técnica fuera de exposición directa. La guía sigue disponible; consultá con el equipo de plataforma si necesitás el contrato o un token de lectura.') },
      { kind: 'bullets', items: [
        t('Un token personal de la sesión autenticada habilita sólo lectura con Authorization: Bearer.'),
        t('Las escrituras de automatización usan el token de aplicación y el encabezado X-Access-Token; ese camino no otorga lectura.'),
        t('Las operaciones reales, sus permisos y sus campos son los que publica el contrato; esta guía no agrega endpoints ni capacidades.'),
      ] },
    ],
  },
};
