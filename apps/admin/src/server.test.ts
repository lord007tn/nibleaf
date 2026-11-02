import { appendResponseHeader, setCookie, setResponseHeader, setResponseStatus } from '@tanstack/react-start/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ startHandler: vi.fn(async () => new Response('ok')) }));

vi.mock('@tanstack/react-start/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-start/server')>()),
  createStartHandler: () => mocks.startHandler,
  defaultStreamHandler: vi.fn(),
}));
vi.mock('@/env.server', () => ({ serverEnv: { NODE_ENV: 'test', VITE_APP_URL: 'http://localhost:4310' } }));

import server from './server';

describe('admin custom Start entry', () => {
  beforeEach(() => mocks.startHandler.mockReset().mockResolvedValue(new Response('ok')));

  it('keeps an endpoint-specific thrown Response and response helper precedence', async () => {
    mocks.startHandler.mockImplementationOnce(async () => {
      setResponseStatus(401);
      setResponseHeader('www-authenticate', 'Bearer');
      setCookie('nibleaf-admin-entry-test', 'first');
      appendResponseHeader('set-cookie', 'nibleaf-admin-extra=second; Path=/');
      throw new Response('Admin authentication required', { status: 403 });
    });
    const response = await server.fetch(new Request('http://localhost:4315/users'));
    expect(response.status).toBe(401);
    expect(await response.text()).toBe('Admin authentication required');
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
    expect(response.headers.getSetCookie()).toHaveLength(2);
    expect(response.headers.get('x-nibleaf-revision')).toBe('development');
  });

  it('strips the body from a thrown Response for a HEAD request', async () => {
    mocks.startHandler.mockRejectedValueOnce(new Response('Admin authentication required', { status: 401 }));
    const response = await server.fetch(new Request('http://localhost:4315/users', { method: 'HEAD' }));
    expect(response.status).toBe(401);
    expect(await response.text()).toBe('');
  });

  it.each([undefined, false, 0])('converts falsy errors (%s) without leaking private information', async (error) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      mocks.startHandler.mockRejectedValueOnce(error);
      const response = await server.fetch(new Request('http://localhost:4315/users'));
      expect(response.status).toBe(500);
      expect(response.headers.get('content-type')).toContain('application/json');
    } finally {
      log.mockRestore();
    }
  });

  it('rejects malformed percent encoding before rendering', async () => {
    const response = await server.fetch(new Request('http://localhost:4315/%E0%A4%A'));
    expect(response.status).toBe(400);
    expect(mocks.startHandler).not.toHaveBeenCalled();
  });

  it('retains the CSP nonce on HTML responses', async () => {
    mocks.startHandler.mockResolvedValueOnce(new Response('<!doctype html><title>Admin</title>', { headers: { 'content-type': 'text/html' } }));
    const response = await server.fetch(new Request('http://localhost:4315/sign-in'));
    expect(response.headers.get('content-security-policy')).toContain("'nonce-");
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
});
