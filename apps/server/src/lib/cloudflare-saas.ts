import got from 'got';
import { env } from '@/env';
import { type CloudflareCustomHostname, cloudflareCustomHostnameSsl } from './cloudflare-saas-state';

export { type CloudflareCustomHostname, customHostnameRecords, customHostnameState } from './cloudflare-saas-state';

interface CloudflareWorkerRoute {
  id: string;
  pattern: string;
  script?: string;
}

interface CloudflareEnvelope<T> {
  success: boolean;
  result?: T;
  errors?: Array<{ code?: number; message?: string }>;
}

export const cloudflareSaasEnabled = (): boolean => env.CUSTOM_DOMAIN_PROVIDER === 'cloudflare-saas';

const config = () => {
  if (!(env.CLOUDFLARE_SAAS_ZONE_ID && env.CLOUDFLARE_SAAS_API_TOKEN)) {
    throw new Error('Cloudflare for SaaS is selected but its zone ID or API token is missing.');
  }
  return { zoneId: env.CLOUDFLARE_SAAS_ZONE_ID, token: env.CLOUDFLARE_SAAS_API_TOKEN };
};

const api = async <T>(path: string, options?: { json?: unknown; method?: 'DELETE' | 'PATCH' | 'POST' }): Promise<T> => {
  const { zoneId, token } = config();
  const response = await got(`https://api.cloudflare.com/client/v4/zones/${zoneId}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    json: options?.json,
    method: options?.method,
    responseType: 'json',
    retry: { limit: 1 },
    throwHttpErrors: false,
    timeout: { request: 15_000 },
  });
  const body = response.body as CloudflareEnvelope<T>;
  if (!response.ok || !body.success || body.result === undefined) {
    const detail = body?.errors
      ?.map((error) => error.message)
      .filter(Boolean)
      .join('; ');
    const error = new Error(detail || `Cloudflare returned HTTP ${response.statusCode}.`);
    Object.assign(error, { status: response.statusCode });
    throw error;
  }
  return body.result;
};

export const createCustomHostname = (hostname: string): Promise<CloudflareCustomHostname> =>
  api('/custom_hostnames', {
    method: 'POST',
    json: {
      hostname,
      ssl: {
        ...cloudflareCustomHostnameSsl,
        settings: { min_tls_version: '1.2', tls_1_3: 'on' },
      },
    },
  });

export const getCustomHostname = (id: string): Promise<CloudflareCustomHostname> => api(`/custom_hostnames/${encodeURIComponent(id)}`);

export const retryCustomHostname = (id: string): Promise<CloudflareCustomHostname> =>
  api(`/custom_hostnames/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    json: {
      ssl: cloudflareCustomHostnameSsl,
    },
  });

export const deleteCustomHostname = async (id: string): Promise<void> => {
  try {
    await api(`/custom_hostnames/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (error) {
    if (!(error instanceof Error) || !('status' in error) || error.status !== 404) throw error;
  }
};

export const createCustomHostnameRoute = (hostname: string): Promise<CloudflareWorkerRoute> =>
  api('/workers/routes', {
    method: 'POST',
    json: { pattern: `${hostname}/*`, script: env.CLOUDFLARE_SAAS_WORKER_SCRIPT },
  });

export const deleteCustomHostnameRoute = async (id: string): Promise<void> => {
  try {
    await api(`/workers/routes/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (error) {
    if (!(error instanceof Error) || !('status' in error) || error.status !== 404) throw error;
  }
};
