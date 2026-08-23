import { describe, expect, it } from 'vitest';
import { createSearchDiagnosticsCursor, readSearchDiagnosticsCursor } from './search-diagnostics-cursor';

const secret = 'test-secret-with-at-least-thirty-two-characters';

describe('search diagnostics cursors', () => {
  it('round-trips a versioned, domain-separated signed cursor', () => {
    const cursor = createSearchDiagnosticsCursor(secret, 'project-a', 'deployment-a', 17);
    expect(cursor.startsWith('v1.')).toBe(true);
    expect(readSearchDiagnosticsCursor(secret, cursor, 'project-a', 'deployment-a')).toBe(17);
  });

  it('rejects signature, version, tenant, and revision tampering', () => {
    const cursor = createSearchDiagnosticsCursor(secret, 'project-a', 'deployment-a', 'offset-a');
    const [version, payload, signature] = cursor.split('.');
    expect(() => readSearchDiagnosticsCursor(secret, `${version}.${payload}x.${signature}`, 'project-a', 'deployment-a')).toThrow(
      'Invalid diagnostics cursor',
    );
    expect(() => readSearchDiagnosticsCursor(secret, `v2.${payload}.${signature}`, 'project-a', 'deployment-a')).toThrow(
      'Invalid diagnostics cursor',
    );
    expect(() => readSearchDiagnosticsCursor(secret, cursor, 'project-b', 'deployment-a')).toThrow('Invalid diagnostics cursor');
    expect(() => readSearchDiagnosticsCursor(secret, cursor, 'project-a', 'deployment-b')).toThrow('Invalid diagnostics cursor');
  });
});
