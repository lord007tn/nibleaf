import { describe, expect, it } from 'vitest';
import { gitConflictResolutionBody, gitConnectionBody, gitOperationBody } from './index';

describe('bidirectional Git validation', () => {
  it('accepts a dedicated branch and least-privilege credential input', () => {
    expect(
      gitConnectionBody.safeParse({
        repository: 'acme/docs',
        baseBranch: 'main',
        headBranch: 'nibleaf/docs',
        token: 'test-credential-value-000000',
      }).success,
    ).toBe(true);
  });

  it('rejects overwriting the base branch and unsafe refs/paths', () => {
    expect(
      gitConnectionBody.safeParse({ repository: 'acme/docs', baseBranch: 'main', headBranch: 'main', token: 'test-credential-value-000000' }).success,
    ).toBe(false);
    expect(
      gitConnectionBody.safeParse({ repository: 'acme/docs', baseBranch: 'main', headBranch: '../escape', token: 'test-credential-value-000000' })
        .success,
    ).toBe(false);
  });

  it('requires commit attribution for push but not polling', () => {
    expect(gitOperationBody.safeParse({ idempotencyKey: 'request-123', kind: 'PUSH' }).success).toBe(false);
    expect(gitOperationBody.safeParse({ idempotencyKey: 'request-124', kind: 'PULL', sourceRef: 'main' }).success).toBe(true);
  });

  it('allows explicit file deletion only through a custom null resolution', () => {
    expect(gitConflictResolutionBody.safeParse({ resolution: 'CUSTOM', content: null }).success).toBe(true);
    expect(gitConflictResolutionBody.safeParse({ resolution: 'CUSTOM' }).success).toBe(false);
  });
});
