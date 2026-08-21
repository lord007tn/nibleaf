import type { MessageCatalogLoader } from './index';
import type { Locale } from './locales';

type Namespace = 'app' | 'auth';

const appLoaders: Record<Exclude<Locale, 'en'>, MessageCatalogLoader> = {
  ar: () => import('virtual:nibleaf-messages/ar/app'),
  'zh-CN': () => import('virtual:nibleaf-messages/zh-CN/app'),
  hi: () => import('virtual:nibleaf-messages/hi/app'),
  es: () => import('virtual:nibleaf-messages/es/app'),
  fr: () => import('virtual:nibleaf-messages/fr/app'),
  bn: () => import('virtual:nibleaf-messages/bn/app'),
  'pt-BR': () => import('virtual:nibleaf-messages/pt-BR/app'),
  ru: () => import('virtual:nibleaf-messages/ru/app'),
  ur: () => import('virtual:nibleaf-messages/ur/app'),
  id: () => import('virtual:nibleaf-messages/id/app'),
  de: () => import('virtual:nibleaf-messages/de/app'),
};

const authLoaders: Record<Exclude<Locale, 'en'>, MessageCatalogLoader> = {
  ar: () => import('virtual:nibleaf-messages/ar/auth'),
  'zh-CN': () => import('virtual:nibleaf-messages/zh-CN/auth'),
  hi: () => import('virtual:nibleaf-messages/hi/auth'),
  es: () => import('virtual:nibleaf-messages/es/auth'),
  fr: () => import('virtual:nibleaf-messages/fr/auth'),
  bn: () => import('virtual:nibleaf-messages/bn/auth'),
  'pt-BR': () => import('virtual:nibleaf-messages/pt-BR/auth'),
  ru: () => import('virtual:nibleaf-messages/ru/auth'),
  ur: () => import('virtual:nibleaf-messages/ur/auth'),
  id: () => import('virtual:nibleaf-messages/id/auth'),
  de: () => import('virtual:nibleaf-messages/de/auth'),
};

export const catalogLoader = (namespace: Namespace) => (locale: Exclude<Locale, 'en'>) => (namespace === 'auth' ? authLoaders : appLoaders)[locale]();
