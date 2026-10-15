import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ connected: vi.fn() }));
vi.mock('@nibleaf/bullmq/queues', () => ({ queues: {} }));
vi.mock('@nibleaf/bullmq/workers', () => ({ areWorkersConnected: mocks.connected }));
vi.mock('@nibleaf/clickhouse', () => ({ clickHouseHealth: vi.fn(async () => ({ status: 'ok' })) }));
vi.mock('@getworkbench/hono', async () => {
  const { Hono } = await import('hono');
  return { workbench: () => new Hono() };
});
vi.mock('../../env', () => ({ env: { POSTMARK_API_KEY: 'synthetic-configured-provider', EMAIL_DELIVERY_REQUIRED: true } }));

import app, { setWorkerReady } from './handlers';

beforeEach(() => {
  mocks.connected.mockReset();
  setWorkerReady(false);
});

it('serves 503 before boot and does not initialize or probe workers through health', async () => {
  const response = await app.request('/health');
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ status: 'starting', queues: { status: 'unavailable' } });
  expect(mocks.connected).not.toHaveBeenCalled();
});

it('reports a lost worker connection as unavailable and recognizes recovery', async () => {
  setWorkerReady(true);
  mocks.connected.mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  expect((await app.request('/health')).status).toBe(200);
  const outage = await app.request('/health');
  expect(outage.status).toBe(503);
  expect(await outage.json()).toMatchObject({ status: 'degraded', queues: { status: 'unavailable' } });
  expect((await app.request('/health')).status).toBe(200);
});
