import type { Finding } from '../types/findings';
import { t } from '../../../cross/i18n/index.ts';

export const categoryLabel = (category: Finding['category']): string => category === 'non_compliance' ? 'No cumple' : category === 'data_quality' ? t('Calidad de datos') : t('Revisión');
