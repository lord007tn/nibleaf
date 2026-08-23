import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '@/errors';

const CURSOR_VERSION = 'v1';
const cursorSchema = z.tuple([z.string(), z.string(), z.union([z.string(), z.number()])]);

const signatureFor = (secret: string, payload: string) =>
  createHmac('sha256', secret).update(`nibleaf:search-diagnostics-cursor:${CURSOR_VERSION}:${payload}`, 'utf8').digest('base64url');

export const createSearchDiagnosticsCursor = (secret: string, projectId: string, deploymentId: string, offset: string | number) => {
  const payload = Buffer.from(JSON.stringify([projectId, deploymentId, offset]), 'utf8').toString('base64url');
  return `${CURSOR_VERSION}.${payload}.${signatureFor(secret, payload)}`;
};

export const readSearchDiagnosticsCursor = (secret: string, cursor: string | undefined, projectId: string, deploymentId: string) => {
  if (!cursor) return;
  try {
    const [version, payload, signature, ...rest] = cursor.split('.');
    if (version !== CURSOR_VERSION || !(payload && signature) || rest.length > 0) throw new Error('malformed cursor');
    const expected = Buffer.from(signatureFor(secret, payload), 'base64url');
    const received = Buffer.from(signature, 'base64url');
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw new Error('invalid signature');
    const decoded = cursorSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
    if (decoded[0] !== projectId || decoded[1] !== deploymentId) throw new Error('scope mismatch');
    return decoded[2];
  } catch {
    throw new AppError({ code: 'validation:failed', message: 'Invalid diagnostics cursor.' });
  }
};
