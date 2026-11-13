import type { WorkspaceIntroHelp } from '../../../source-contract';
import { t } from '../../../cross/i18n/index.ts';

export const NETSKOPE_DEVICE_INVENTORY_HELP: WorkspaceIntroHelp = {
  "label": t('Evidencia del inventario Netskope'),
  "paragraphs": [
    t('Al abrir una fila se ve una ficha corta: el equipo, su usuario, su última señal, el rendimiento digital del equipo según ADEM (puntaje de 0 a 100 que resume equipo, red y aplicaciones en las últimas 24 h; mayor es mejor) con su POP y, con permiso, las anomalías UEBA del usuario: comportamientos inusuales que detectó Netskope en los últimos 30 días. Netskope no informa en qué equipo ocurrió cada anomalía. Los enlaces abren la ficha del usuario con el desglose por componente y la lista de anomalías.'),
    t('El estado compartido corresponde al último intento de sincronizar el inventario de clientes; sólo una corrida completa de las últimas 24 horas aporta evidencia vigente. Las capturas de alertas, DLP y confianza de usuarios no renuevan esa evidencia.'),
    t('El usuario observado se vincula solo cuando coincide exactamente con el ID o correo del usuario. Otros identificadores informados por Netskope no crean vínculos. No hay conteos de alertas por equipo o usuario.'),
    t('El estado de la señal (reciente, sin señal reciente, candidato a revisión) es una evaluación de Custodia sobre el último evento reportado por Netskope. La antigüedad de un evento no demuestra que el equipo esté fuera de línea ni sin protección.'),
    t('Una asociación histórica no confirma uso actual ni propiedad.')
  ]
};

export const NETSKOPE_USER_INVENTORY_HELP: WorkspaceIntroHelp = {
  "label": t('Evidencia del inventario Netskope'),
  "paragraphs": [
    t('El estado compartido corresponde al último intento de sincronizar el inventario de clientes; sólo una corrida completa de las últimas 24 horas aporta evidencia vigente. Las capturas de alertas, DLP y confianza de usuarios no renuevan esa evidencia.'),
    t('El usuario observado se vincula solo cuando coincide exactamente con el ID o correo del usuario. Otros identificadores informados por Netskope no crean vínculos. No hay conteos de alertas por equipo o usuario.'),
    t('Directorio Netskope para detectar identidades sin equipos observados. Las identidades ya vinculadas se consultan junto a su equipo en la vista principal.')
  ]
};
