/**
 * i18n de Custodia: español (fuente) e inglés.
 *
 * Estilo gettext: la clave es el texto en español tal como está en el código,
 * `t('Buscar')`. Así un texto se traduce envolviéndolo, sin inventar claves,
 * y lo que todavía no tiene traducción se muestra en español en vez de romperse.
 * Variables con llaves: `t('Hola, {name}', { name })`.
 *
 * El idioma se decide una vez al cargar (?lang=, luego lo guardado y por
 * último el valor por defecto) y cambiarlo recarga la página: así también se
 * traducen las constantes que el código arma al importarse.
 */
import { EN } from './en.ts';

export type Locale = 'es' | 'en';
export const LOCALES: readonly Locale[] = ['es', 'en'];
const STORAGE_KEY = 'custodia.locale';
const isLocale = (value: unknown): value is Locale => value === 'es' || value === 'en';

function storage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

/** La demo publicada sigue al navegador; la app con backend arranca en español. */
function fallbackLocale(): Locale {
  if (typeof navigator === 'undefined' || import.meta.env?.VITE_DEMO !== '1') return 'es';
  return navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en';
}

export function detectLocale(): Locale {
  if (typeof window === 'undefined') return 'es';
  const requested = new URLSearchParams(window.location.search).get('lang');
  if (isLocale(requested)) {
    storage()?.setItem(STORAGE_KEY, requested);
    return requested;
  }
  const saved = storage()?.getItem(STORAGE_KEY);
  return isLocale(saved) ? saved : fallbackLocale();
}

let current: Locale = detectLocale();
if (typeof document !== 'undefined') document.documentElement.lang = current;

export const locale = () => current;
/** Etiqueta BCP 47 para Intl (fechas, números, orden). */
export const localeTag = () => (current === 'en' ? 'en-US' : 'es-AR');

const DICTIONARIES: Record<Locale, Record<string, string>> = { es: {}, en: EN };

export function t(source: string, vars?: Record<string, string | number>): string {
  const text = DICTIONARIES[current][source] ?? source;
  return vars ? text.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match)) : text;
}

/** Plural simple: `tn(n, '{n} Safe', '{n} Safes')`. */
export function tn(count: number, one: string, other: string, vars?: Record<string, string | number>): string {
  return t(count === 1 ? one : other, { n: count, ...vars });
}

export function setLocale(next: Locale) {
  if (next === current) return;
  storage()?.setItem(STORAGE_KEY, next);
  const url = new URL(window.location.href);
  url.searchParams.delete('lang');
  window.location.replace(url.toString());
}

/** Sólo para pruebas: cambia el idioma sin recargar. */
export function __setLocaleForTests(next: Locale) { current = next; }
