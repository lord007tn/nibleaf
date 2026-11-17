import { expect, it } from 'vitest';
import { gitbookImportBody, mintlifyImportBody } from './index';

it.each([mintlifyImportBody, gitbookImportBody])('validates optional import source URLs without throwing', (schema) => {
  for (const sourceUrl of ['not a URL', 'javascript:alert(1)', 'https://writer:secret@help.example.test']) {
    expect(schema.safeParse({ repo: 'synthetic/docs', sourceUrl }).success).toBe(false);
  }
  expect(schema.safeParse({ repo: 'synthetic/docs', sourceUrl: 'https://help.example.test/docs' }).success).toBe(true);
});
