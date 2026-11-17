import { describe, expect, it } from 'vitest';
import { ghostImportRefusal, ghostImportRequestBody, isGhostImportFor, isValidImportUrl, MAX_GHOST_FILE_BYTES } from './ghost-import';

describe('Ghost import preparation', () => {
  it.each([
    ['https://blog.example.com', true],
    ['http://blog.example.com/path', true],
    ['https://user:secret@blog.example.com', false],
    ['https://user@blog.example.com', false],
    ['ftp://blog.example.com', false],
    ['javascript:alert(1)', false],
    ['blog.example.com', false],
    ['', false],
  ])('accepts %s as the site URL: %s', (url, valid) => {
    expect(isValidImportUrl(url)).toBe(valid);
  });

  it('refuses the URL first, then a file over 15 MiB, before anything is read', () => {
    expect(MAX_GHOST_FILE_BYTES).toBe(15 * 1024 * 1024);
    expect(ghostImportRefusal({ fileSize: MAX_GHOST_FILE_BYTES + 1, ghostUrl: 'nope' })).toBe('settings.import.ghost.invalidUrl');
    expect(ghostImportRefusal({ fileSize: MAX_GHOST_FILE_BYTES + 1, ghostUrl: 'https://blog.example.com' })).toBe('settings.import.ghost.tooLarge');
    expect(ghostImportRefusal({ fileSize: MAX_GHOST_FILE_BYTES, ghostUrl: 'https://blog.example.com' })).toBeNull();
  });

  it('sends the export as it was read, with the site URL under __nibleafImport', () => {
    const document = { db: [{ data: { posts: [] } }], extra: { kept: true } };
    expect(ghostImportRequestBody(JSON.stringify(document), 'https://blog.example.com')).toEqual({
      ...document,
      __nibleafImport: { ghostUrl: 'https://blog.example.com' },
    });
  });

  it.each(['', '{"db": [', 'null', '"ghost"', '42', '[{"db": []}]'])('refuses %j: not a JSON object', (text) => {
    expect(ghostImportRequestBody(text, 'https://blog.example.com')).toBeNull();
  });

  it('matches pending requests to their own site', () => {
    expect(isGhostImportFor({ projectId: 'site-a', body: {} }, 'site-a')).toBe(true);
    expect(isGhostImportFor({ projectId: 'site-a', body: {} }, 'site-b')).toBe(false);
    expect(isGhostImportFor(undefined, 'site-a')).toBe(false);
    expect(isGhostImportFor('site-a', 'site-a')).toBe(false);
  });
});
