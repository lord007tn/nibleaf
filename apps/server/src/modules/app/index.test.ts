import { afterEach, describe, expect, it } from 'vitest';
import app from './index';

const originalRevision = process.env.NIBLEAF_REVISION;

afterEach(() => {
  if (originalRevision === undefined) {
    delete process.env.NIBLEAF_REVISION;
  } else {
    process.env.NIBLEAF_REVISION = originalRevision;
  }
});

describe('app API health', () => {
  it('proves the running image revision in both the header and body', async () => {
    const revision = '468828d42045856592715a395ed0816a615b39c3';
    process.env.NIBLEAF_REVISION = revision;

    const response = await app.request('/health');

    expect(response.status).toBe(200);
    expect(response.headers.get('x-nibleaf-revision')).toBe(revision);
    await expect(response.json()).resolves.toEqual({ ok: true, revision });
  });
});
