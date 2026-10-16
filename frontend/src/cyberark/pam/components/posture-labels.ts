import type { Finding } from '../types/findings';

export const categoryLabel = (category: Finding['category']): string => category === 'non_compliance' ? 'No cumple' : category === 'data_quality' ? 'Calidad de datos' : 'Revisión';
