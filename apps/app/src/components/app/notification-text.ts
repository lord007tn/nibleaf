import type { MessageKey, MessageVariables } from '@nibleaf/i18n';
import type { NotificationItem } from '@/hooks/api/types';
import { failureMessageKey } from '../failure-message';

type Translate = (key: MessageKey, variables?: MessageVariables) => string;
const isolate = (value: string) => `\u2068${value}\u2069`;

export function notificationText(t: Translate, item: NotificationItem) {
  const params = item.params && typeof item.params === 'object' && !Array.isArray(item.params) ? (item.params as Record<string, unknown>) : null;
  const failure = item.type === 'deploy_failed' || item.type === 'export_failed';
  if (failure) {
    const detail = typeof params?.details === 'string' ? params.details : params ? null : item.body;
    return {
      title:
        item.type === 'deploy_failed' && typeof params?.projectName === 'string'
          ? t('notifications.deployFailed.namedTitle', { project: isolate(params.projectName) })
          : t(item.type === 'deploy_failed' ? 'notifications.deployFailed.title' : 'notifications.exportFailed.title'),
      body: t(failureMessageKey(detail ?? '', item.type === 'deploy_failed' ? 'publish' : 'export')),
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
    return { title: t('notifications.importReady.title'), body: t('notifications.importReady.body') };
  }
  if (item.type === 'feedback' && params) {
    return { title: t('notifications.feedback.title'), body: t('notifications.feedback.body') };
  }
  // Old rows and unknown event types remain readable after an additive upgrade.
  return { title: item.title, body: item.body };
}
