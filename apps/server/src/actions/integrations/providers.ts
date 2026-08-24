import type { Locale } from '@nibleaf/i18n/locales';
import { settings_integrations_testmessage } from '@nibleaf/i18n/messages';
import { createLogger } from '@nibleaf/logger';
import { IncomingWebhook } from '@slack/webhook';
import got from 'got';
import { AppError } from '@/errors';

type WebhookProviderId = 'slack' | 'discord' | 'zapier';

const log = createLogger({ action: 'integration-provider' });

const providerFailure = (providerId: WebhookProviderId, error: unknown) => {
  log.warn({ providerId, errorName: error instanceof Error ? error.name : 'unknown' }, 'integration provider verification failed');
  return new AppError({
    code: 'integration:provider_unavailable',
    message: 'The provider could not verify this connection.',
    details: { providerId },
  });
};

/** Provider verification is intentionally provider-specific. Slack and Zapier
 * require an explicit external test event; Discord supports a passive metadata
 * read. Raw responses and credential-bearing URLs never leave this boundary. */
export const verifyWebhookProvider = async (providerId: WebhookProviderId, webhookUrl: string, locale: Locale) => {
  try {
    if (providerId === 'slack') {
      const result = await new IncomingWebhook(webhookUrl).send({ text: settings_integrations_testmessage(undefined, { locale }) });
      return { responseStatus: result.text === 'ok' ? 200 : null };
    }
    if (providerId === 'discord') {
      const response = await got.get(webhookUrl, {
        throwHttpErrors: false,
        retry: { limit: 0 },
        timeout: { request: 8000 },
      });
      if (response.statusCode < 200 || response.statusCode >= 300) throw new Error('Discord verification rejected.');
      return { responseStatus: response.statusCode };
    }
    const response = await got.post(webhookUrl, {
      json: { event: 'integration.test', version: 1, sentAt: new Date().toISOString() },
      throwHttpErrors: false,
      retry: { limit: 0 },
      timeout: { request: 8000 },
    });
    if (response.statusCode < 200 || response.statusCode >= 300) throw new Error('Zapier verification rejected.');
    return { responseStatus: response.statusCode };
  } catch (error) {
    throw providerFailure(providerId, error);
  }
};
