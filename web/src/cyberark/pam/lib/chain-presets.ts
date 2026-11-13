import type { ChainNodeType } from '../../../cross/lib/chains-api';

import type { ChainPreset } from '../../../cross/lib/chain-preset-types';
import { t } from '../../../cross/i18n/index.ts';
export type { ChainPreset, ChainPresetSearch } from '../../../cross/lib/chain-preset-types';

export const CHAIN_PRESETS: ChainPreset[] = [
  {
    id: 'who-reaches-psm',
    label: t('¿Quién llega a este PSM?'),
    hint: t('Muestra las plataformas que usan el PSM seleccionado.'),
    requiresType: 'psm',
    direction: 'back',
  },
  {
    id: 'what-role-reaches',
    label: t('¿Qué alcanza este rol?'),
    hint: t('Muestra los Safes que concede el rol seleccionado.'),
    requiresType: 'role',
    direction: 'forward',
  },
  {
    id: 'suspended-users',
    label: t('Usuarios PAM suspendidos con roles activos'),
    hint: t('Busca usuarios suspendidos en CyberArk, un campo persistido.'),
    search: { query: '', types: ['user'], status: 'suspended' },
  },
];

export function presetApplies(preset: ChainPreset, currentType: ChainNodeType | null): boolean {
  return !preset.requiresType || preset.requiresType === currentType;
}
