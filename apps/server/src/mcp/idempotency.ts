import { canonicalHash } from '@/lib/canonical-json';

export { canonicalHash, sha256Hex } from '@/lib/canonical-json';

import { type Prisma, prisma } from '@nibleaf/database';
import { z } from 'zod';
import { AppError } from '@/errors';
import { mcpCredentialColumns } from './credential';
import type { McpPrincipal } from './types';

/** Replay records live this long; expired rows are pruned lazily per project. */
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export const CLIENT_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export const clientRequestIdSchema = z
  .string()
  .regex(CLIENT_REQUEST_ID_PATTERN, 'Use 8-128 characters from A-Z, a-z, 0-9, ".", "_", ":" and "-".')
  .describe(
    'Optional idempotency id for this write. Reuse the same value only when retrying the identical call (for example after a timeout): the stored result is returned instead of writing twice. Use a new value for every new write.',
  );

/** SHA-256 of the canonical tool arguments, excluding the idempotency id itself. */
export const hashMcpArguments = (args: Record<string, unknown>) => {
  const { clientRequestId: _clientRequestId, ...rest } = args;
  return canonicalHash(rest);
};

export const isUniqueViolation = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'P2002';

interface IdempotencyScope {
  projectId: string;
  credential: Pick<McpPrincipal['credential'], 'kind' | 'id'>;
  operation: string;
  clientRequestId: string;
}

/** The unique replay key of a credential: per API key, or per OAuth grant. */
const replayKey = ({ credential, operation, clientRequestId }: IdempotencyScope) =>
  credential.kind === 'oauth'
    ? { oauthGrantId_operation_clientRequestId: { oauthGrantId: credential.id, operation, clientRequestId } }
    : { apiKeyId_operation_clientRequestId: { apiKeyId: credential.id, operation, clientRequestId } };

type IdempotencyStart = { kind: 'execute'; recordId: string } | { kind: 'replay'; result: Prisma.JsonValue };

const inProgress = () =>
  new AppError({
    code: 'mcp:idempotency_in_progress',
    message:
      'A call with this clientRequestId is still running. Retry the identical call shortly; if this persists, re-read the current state before writing again with a new clientRequestId.',
  });

/** Claim `clientRequestId` for this call, or return the stored result of an
 *  identical earlier call. The insert is the claim: the unique key
 *  (apiKeyId or oauthGrantId, operation, clientRequestId) makes a concurrent duplicate fail with
 *  P2002, and that loser then inspects the winner's row instead of writing. */
export const beginMcpIdempotentWrite = async (scope: IdempotencyScope, argsHash: string, now = new Date()): Promise<IdempotencyStart> => {
  await prisma.mcpIdempotencyRecord.deleteMany({ where: { projectId: scope.projectId, expiresAt: { lte: now } } });
  try {
    const record = await prisma.mcpIdempotencyRecord.create({
      data: {
        projectId: scope.projectId,
        ...mcpCredentialColumns(scope.credential),
        operation: scope.operation,
        clientRequestId: scope.clientRequestId,
        argsHash,
        status: 'pending',
        expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
      },
      select: { id: true },
    });
    return { kind: 'execute', recordId: record.id };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }
  const existing = await prisma.mcpIdempotencyRecord.findUnique({
    where: replayKey(scope),
    select: { argsHash: true, status: true, result: true },
  });
  // Deleted between our failed insert and this read: the other call failed and
  // released the id, so the caller can simply retry.
  if (!existing) throw inProgress();
  if (existing.argsHash !== argsHash) {
    throw new AppError({
      code: 'mcp:idempotency_conflict',
      message: 'This clientRequestId was already used with different arguments. Use a new clientRequestId for a different write.',
    });
  }
  if (existing.status !== 'completed' || existing.result === null) throw inProgress();
  return { kind: 'replay', result: existing.result };
};

/** Store the compact replay result once the write succeeded. */
export const completeMcpIdempotentWrite = (recordId: string, result: Prisma.InputJsonValue, now = new Date()) =>
  prisma.mcpIdempotencyRecord.update({ where: { id: recordId }, data: { status: 'completed', result, completedAt: now }, select: { id: true } });

/** Release the id after a failed write so a corrected retry can use it again. */
export const abandonMcpIdempotentWrite = (recordId: string) => prisma.mcpIdempotencyRecord.deleteMany({ where: { id: recordId, status: 'pending' } });
