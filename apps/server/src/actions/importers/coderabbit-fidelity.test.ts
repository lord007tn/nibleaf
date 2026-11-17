import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { scanAuthoredEmbeds } from '@nibleaf/shared/reader-embeds';
import { describe, expect, it } from 'vitest';
import { convertGitBookMarkdown } from './gitbook-markdown';
import { buildMintlifyRouteMap, mintlifyInternalLinkTargets, rewriteMintlifyInternalLinks } from './mintlify-links';
import { normalizeMintlifyMdx } from './mintlify-mdx';

const converters = [
  ['GitBook', (source: string) => convertGitBookMarkdown(source, { resolveFile: () => undefined }).content],
  ['Mintlify', normalizeMintlifyMdx],
] as const;

describe('CodeRabbit fidelity follow-up', () => {
  it.each(converters)('already fixed: %s excludes quoted inline code from derived titles', (_name, convert) => {
    const code = '`a "b" < c`';
    const content = convert(`Heading "safe" & sound\n\nText ${code}\n\n<iframe src="https://youtu.be/abcdefghijk"></iframe>`);
    expect(content.split(code)).toHaveLength(2);
    expect(content).not.toContain('\uE000');
    const embed = scanAuthoredEmbeds(content)[0];
    expect([...(embed?.attributes.keys() ?? [])]).toEqual(['src', 'title']);
    expect(embed?.attributes.get('title')).toBe('Heading "safe" & sound');
    expect(content).toContain('title="Heading &quot;safe&quot; &amp; sound"');
  });

  it.each(converters)('already fixed: %s keeps a standalone indented provider link byte for byte', (_name, convert) => {
    const source = '    [Tour](https://youtu.be/abcdefghijk)';
    expect(convert(source)).toBe(source);
  });

  it('discovers and rewrites the same hidden page on a configured application origin', () => {
    const source = '[Hidden](https://app.example.test/pages/hidden#start)';
    const origins = ['https://nibleaf.com', 'https://app.example.test'];
    expect(mintlifyInternalLinkTargets(source, 'intro', undefined, origins)).toEqual(['hidden']);
    expect(rewriteMintlifyInternalLinks(source, 'intro', new Map([['hidden', '/additional-pages/hidden']]), { appOrigins: origins })).toBe(
      '[Hidden](/additional-pages/hidden#start)',
    );
  });

  it.each(['guides/café', 'guides/مرحبا', 'guides/%broken'])('resolves encoded and plain segments to the same page: %s', (path) => {
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    const routes = buildMintlifyRouteMap([{ kind: 'page', path }]);
    expect([...buildMintlifyRouteMap([{ kind: 'page', path: encoded }]).keys()]).toEqual([path]);
    const issues: string[] = [];
    for (const reference of [path, encoded]) {
      expect(mintlifyInternalLinkTargets(`[Next](/${reference})`, 'intro')).toEqual([path]);
      expect(
        rewriteMintlifyInternalLinks(`[Next](https://help.test/${reference}?lang=ar#start)`, 'intro', routes, {
          sourceUrl: 'https://help.test',
          onUnresolved: (url) => issues.push(url),
        }),
      ).toBe(`[Next](${routes.get(path)}?lang=ar#start)`);
    }
    expect(issues).toEqual([]);
  });

  it('maps an extensionless GitBook video through the shared guarded media path', () => {
    const converted = convertGitBookMarkdown('{% video src="https://media.example.test/recordings/123" title="Training" %}', {
      resolveFile: () => undefined,
    });
    expect(converted.content).toBe('<video controls src="https://media.example.test/recordings/123" title="Training"></video>');
    expect(converted.issues).toEqual([]);
  });

  it.each(['http://media.example.test/recordings/123', '//media.example.test/recordings/123', 'https://youtu.be\\abcdefghijk'])(
    'rejects unsafe extensionless video: %s',
    (src) => {
      const converted = convertGitBookMarkdown(`{% video src="${src}" %}`, { resolveFile: () => undefined });
      expect(converted.content).not.toMatch(/<(?:video|iframe)\b/);
      expect(converted.issues).toHaveLength(1);
    },
  );
});

describe('capture Redis preflight before any worker or lock', () => {
  const source = readFileSync(new URL('../../../../../tests/integration/import-fidelity/browser.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('assert.ok(process.env.NIBLEAF_DEVSTACK_LOCK');
  const end = source.indexOf('/** Every host');
  const env = {
    NIBLEAF_DEVSTACK_LOCK: 'unused-test-lock',
    POSTGRES_URL: 'postgresql://localhost/import_fidelity_test',
    NIBLEAF_CAPTURE_DATABASE: 'import_fidelity_test',
    API_PORT: '4410',
    REDIS_DB: '143',
    NIBLEAF_CAPTURE_REDIS_DB: '143',
  };
  const preflight = (overrides: Record<string, string | undefined>) => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    runInNewContext(source.slice(start, end), { assert, URL, process: { env: { ...env, ...overrides } } });
  };
  it.each([undefined, '', '0', '-1', '1.5', 'NaN', '9007199254740992'])('refuses an unset or invalid Redis DB: %s', (value) => {
    expect(() => preflight({ REDIS_DB: value })).toThrow(/Redis|REDIS/);
  });
  it('refuses a Redis DB different from the explicitly allocated capture DB', () => {
    expect(() => preflight({ REDIS_DB: '144' })).toThrow(/allocated/);
    expect(() => preflight({ NIBLEAF_CAPTURE_REDIS_DB: undefined })).toThrow(/allocated/);
  });
  it('accepts the explicitly allocated capture Redis DB', () => {
    expect(() => preflight({})).not.toThrow();
  });
});
