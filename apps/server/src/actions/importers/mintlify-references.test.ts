import { describe, expect, it } from 'vitest';
import { ImportError } from '@/errors';
import { resolveMintlifyReferences } from './mintlify-references';

const resolve = (document: unknown, entries: Record<string, string>) =>
  resolveMintlifyReferences(document, 'docs.json', new Set(['docs.json', ...Object.keys(entries)]), async (filePath) => entries[filePath] ?? null);

describe('Mintlify JSON references', () => {
  it('resolves split navigation files and nested fragments', async () => {
    const result = await resolve(
      { name: 'Acme', navigation: { $ref: './navigation.json#/navigation', global: { anchors: [] } } },
      {
        'navigation.json': JSON.stringify({
          navigation: { products: [{ product: 'Platform', groups: { $ref: './groups.json' } }] },
        }),
        'groups.json': JSON.stringify([{ group: 'Start', pages: ['overview'] }]),
      },
    );

    expect(result).toEqual({
      name: 'Acme',
      navigation: {
        products: [{ product: 'Platform', groups: [{ group: 'Start', pages: ['overview'] }] }],
        global: { anchors: [] },
      },
    });
  });

  it('rejects traversal, missing files, and circular references with coded errors', async () => {
    await expect(resolve({ $ref: '../private.json' }, {})).rejects.toMatchObject({ code: 'import:unsupported' });
    await expect(resolve({ $ref: './missing.json' }, {})).rejects.toMatchObject({ code: 'import:not_found' });
    await expect(
      resolve({ $ref: './a.json' }, { 'a.json': JSON.stringify({ $ref: './b.json' }), 'b.json': JSON.stringify({ $ref: './a.json' }) }),
    ).rejects.toBeInstanceOf(ImportError);
  });

  it('ignores sibling keys when a reference resolves to a non-object value', async () => {
    await expect(resolve({ navigation: { $ref: './navigation.json', label: 'ignored' } }, { 'navigation.json': '["overview"]' })).resolves.toEqual({
      navigation: ['overview'],
    });
  });
});
