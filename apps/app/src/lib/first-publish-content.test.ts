import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { blogEntry } from './blog';
import { articleHead } from './blog-seo';

const articles = import.meta.glob<string>(
  ['../content/blog/introducing-nibleaf-open-source-mintlify-alternative.mdx', '../content/blog/self-host-documentation-site-docker-compose.mdx'],
  { eager: true, query: '?raw', import: 'default' },
);
const intro = Object.entries(articles).find(([file]) => file.includes('introducing-nibleaf'))?.[1] ?? '';
const selfHost = Object.entries(articles).find(([file]) => file.includes('self-host-documentation'))?.[1] ?? '';

describe('alternatives and self-hosting first-publish content', () => {
  it('uses one source-specific activation bridge in each existing canonical article', () => {
    expect(intro.match(/<FirstPublishBridge source="mintlify_introduction" \/>/gu)).toHaveLength(1);
    expect(selfHost.match(/<FirstPublishBridge source="docker_compose_guide" \/>/gu)).toHaveLength(1);
    expect(`${intro}${selfHost}`.match(/<FirstPublishBridge/gu)).toHaveLength(2);
    expect(intro).toContain('/compare/nibleaf-vs-mintlify');
    expect(selfHost).toContain('/self-hosting');
  });

  it('keeps canonical Article and FAQ structured data on both slugs', () => {
    for (const slug of ['introducing-nibleaf-open-source-mintlify-alternative', 'self-host-documentation-site-docker-compose']) {
      const entry = blogEntry(slug);
      if (!entry) throw new Error(`${slug} is missing from the blog manifest.`);
      const head = articleHead(entry);
      const canonical = head.links.find((link) => link.rel === 'canonical');
      expect(canonical?.href).toMatch(new RegExp(`/blog/${slug}$`, 'u'));
      const structuredTypes = head.scripts.map((script) => JSON.parse(script.children)['@type']);
      expect(structuredTypes).toEqual(expect.arrayContaining(['Article', 'FAQPage']));
    }
  });

  it('binds the runnable workflow and backup boundary to the published release sources', () => {
    const release = JSON.parse(readFileSync(new URL('../../../../release/self-host.json', import.meta.url), 'utf8')) as {
      composeSha256: string;
      installerSha256: string;
      version: string;
    };
    const installer = readFileSync(new URL('../../../../scripts/install.sh', import.meta.url), 'utf8');
    const compose = readFileSync(new URL('../../../../docker-compose.prod.yml', import.meta.url), 'utf8');

    expect(selfHost).toContain(release.version);
    expect(selfHost).toContain(release.installerSha256);
    expect(selfHost).toContain(release.composeSha256);
    expect(installer).not.toContain('scripts/backup.sh');
    expect(selfHost).toContain('does not deliver the repository helper');
    for (const service of ['app', 'server', 'worker', 'migrate', 'postgres', 'dragonfly', 'maxio']) {
      expect(compose).toMatch(new RegExp(`^  ${service}:`, 'mu'));
      expect(selfHost).toContain(`\`${service}\``);
    }
    expect(selfHost).toContain('docker compose logs migrate');
    expect(selfHost).toContain('Click **Publish** yourself');
  });

  it('ships durable English and Arabic/RTL product evidence', () => {
    expect(existsSync(new URL('../../public/images/first-publish/editor-en.png', import.meta.url))).toBe(true);
    expect(existsSync(new URL('../../public/images/first-publish/dashboard-ar-rtl.jpg', import.meta.url))).toBe(true);
    expect(intro).toContain('/images/first-publish/dashboard-ar-rtl.jpg');
    expect(intro).toContain('right-to-left');
  });
});
