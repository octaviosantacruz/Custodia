import { installCompanyApi } from './api';
import { company, validMode } from './company';
import { setPresentationTime } from '../src/cross/lib/presentation-clock';

setPresentationTime(company.asOf);
installCompanyApi(validMode(sessionStorage.getItem('faro-source-mode')));
await import('../src/main.tsx');
