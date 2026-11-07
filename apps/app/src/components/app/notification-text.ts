import type { MessageKey, MessageVariables } from '@nibleaf/i18n';
import type { NotificationItem } from '@/hooks/api/types';
import type { ProjectAdminStatus } from '@/hooks/use-project-admin-status';
import { localeTag } from '@/lib/format';
import { failureMessageKey } from '../failure-message';

type Translate = (key: MessageKey, variables?: MessageVariables) => string;
const isolate = (value: string) => `\u2068${value}\u2069`;

const notificationParams = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** New rows keep diagnostics in params; legacy rows keep them in the body. */
export function notificationDetails(item: NotificationItem) {
  const params = notificationParams(item.params);
  return typeof params?.details === 'string' ? params.details : params ? null : item.body;
}

function importCount(t: Translate, locale: string, count: number, kind: 'imported' | 'updated') {
  const category = new Intl.PluralRules(locale === 'ar' ? 'ar' : 'en').select(count);
  return t(`notifications.importReady.${kind}.${category}`, { count: new Intl.NumberFormat(localeTag(locale)).format(count) });
}

export function notificationText(t: Translate, item: NotificationItem, locale = 'en', role: ProjectAdminStatus = 'pending') {
  const params = notificationParams(item.params);
  const failure = item.type === 'deploy_failed' || item.type === 'export_failed';
  if (failure) {
    const detail = notificationDetails(item);
    return {
      title:
        item.type === 'deploy_failed' && typeof params?.projectName === 'string'
          ? t('notifications.deployFailed.namedTitle', { project: isolate(params.projectName) })
          : item.type === 'deploy_failed' && !params
            ? item.title
            : t(item.type === 'deploy_failed' ? 'notifications.deployFailed.title' : 'notifications.exportFailed.title'),
      body: t(failureMessageKey(detail ?? '', item.type === 'deploy_failed' ? 'publish' : 'export', role)),
      details: detail,
    };
  }
  if (item.type === 'deploy_ready' && typeof params?.projectName === 'string' && typeof params.version === 'number') {
    return {
      title: t('notifications.deployReady.title', { project: isolate(params.projectName) }),
      body: t('notifications.deployReady.body', { version: isolate(String(params.version)) }),
    };
  }
  if (item.type === 'export_ready' && params) {
    return { title: t('notifications.exportReady.title'), body: t('notifications.exportReady.body') };
  }
  if (item.type === 'import_completed' && typeof params?.imported === 'number' && typeof params.updated === 'number') {
    const source =
      params.source === 'git'
        ? t('notifications.importReady.gitSource')
        : typeof params.source === 'string'
          ? params.source
          : t('notifications.importReady.unknownSource');
    return {
      title: t('notifications.importReady.title'),
      body: t('notifications.importReady.summary', {
        imported: importCount(t, locale, params.imported, 'imported'),
        updated: importCount(t, locale, params.updated, 'updated'),
        source: isolate(source),
      }),
    };
  }
  if (item.type === 'feedback' && params) {
    const page = typeof params.path === 'string' && params.path ? params.path : t('notifications.feedback.unknownPage');
    const key =
      params.sentiment === 'helpful'
        ? 'notifications.feedback.helpful'
        : params.sentiment === 'not helpful'
          ? 'notifications.feedback.notHelpful'
          : 'notifications.feedback.onPage';
    return { title: t('notifications.feedback.title'), body: t(key, { page: isolate(page) }) };
  }
  // Old rows and unknown event types remain readable after an additive upgrade.
  return { title: item.title, body: item.body };
}
