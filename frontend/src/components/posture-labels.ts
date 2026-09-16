import type { Finding } from '../types/findings';

export const severityLabel = (severity: Finding['severity']): string => ({ low: 'Baja', medium: 'Media', high: 'Alta', critical: 'Crítica' }[severity]);
export const categoryLabel = (category: Finding['category']): string => category === 'non_compliance' ? 'No cumple' : category === 'data_quality' ? 'Calidad de datos' : 'Revisión';
