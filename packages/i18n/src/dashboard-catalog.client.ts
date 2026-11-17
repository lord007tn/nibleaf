import generatedAliases from './generated/dashboard/message-aliases.json';
import * as english from './generated/dashboard/messages/en.js';
import type { Locale } from './locales';
import type { MessageFn } from './message-types';
import { registerLanguagePreparation } from './runtime';

type Catalog = Readonly<Record<string, MessageFn>>;

// Literal import paths keep each locale an independent dynamic entry point.
// English is always available for a missing key or an unavailable download.
const imports = {
  ar: () => import('./generated/dashboard/messages/ar.js'),
  'zh-CN': () => import('./generated/dashboard/messages/zh-CN.js'),
  hi: () => import('./generated/dashboard/messages/hi.js'),
  es: () => import('./generated/dashboard/messages/es.js'),
  fr: () => import('./generated/dashboard/messages/fr.js'),
  bn: () => import('./generated/dashboard/messages/bn.js'),
  'pt-BR': () => import('./generated/dashboard/messages/pt-BR.js'),
  ru: () => import('./generated/dashboard/messages/ru.js'),
  ur: () => import('./generated/dashboard/messages/ur.js'),
  id: () => import('./generated/dashboard/messages/id.js'),
  de: () => import('./generated/dashboard/messages/de.js'),
};

const englishCatalog = english as unknown as Catalog;
const aliases = generatedAliases as Readonly<Record<string, string>>;
const catalogs = new Map<Locale, Catalog>([['en', englishCatalog]]);
const pending = new Map<Locale, Promise<boolean>>();

export const dashboardMessage = (id: string, locale: Locale): MessageFn | undefined => {
  const identifier = aliases[id] ?? id;
  return catalogs.get(locale)?.[identifier] ?? englishCatalog[identifier];
};

// The app supplies its optional-load wrapper so failed locale downloads use
// the existing page fallback rather than the stale-route reload mechanism.
let optionalLoad = (load: () => Promise<unknown>): Promise<unknown> => load();
let isDashboardActive = () => true;

export function configureDashboardLocaleLoading(wrapper: typeof optionalLoad, active = () => true): void {
  optionalLoad = wrapper;
  isDashboardActive = active;
}

export function prepareDashboardLocale(locale: Locale): Promise<boolean> {
  if (catalogs.has(locale)) return Promise.resolve(true);
  const inFlight = pending.get(locale);
  if (inFlight) return inFlight;
  const download = optionalLoad(() => imports[locale as Exclude<Locale, 'en'>]())
    .then(
      (catalog) => {
        catalogs.set(locale, catalog as unknown as Catalog);
        return true;
      },
      () => false,
    )
    .finally(() => pending.delete(locale));
  pending.set(locale, download);
  return download;
}

registerLanguagePreparation((locale) => (isDashboardActive() ? prepareDashboardLocale(locale) : Promise.resolve(true)));
