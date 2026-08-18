import { describe, expect, it } from 'vitest';
import {
  findMintlifyConfigPath,
  mapMintlifyConfig,
  mergeConfigPreservingExisting,
  type NavGroupNode,
  type NavNode,
  parseMintlifyLanguages,
  parseMintlifyNavigation,
} from './mintlify-mapping';

/** docs.json (2024+ schema) fixture: tabs → groups → pages with nesting + global anchors. */
const docsJson = {
  name: 'Acme Docs',
  colors: { primary: '#16A34A', light: '#22C55E' },
  logo: { light: 'https://cdn.acme.dev/logo/light.svg', dark: 'https://cdn.acme.dev/logo/dark.svg' },
  favicon: 'https://cdn.acme.dev/favicon.png',
  navbar: {
    links: [{ label: 'Support', href: 'https://acme.dev/support' }],
    primary: { type: 'button', label: 'Dashboard', href: 'https://app.acme.dev' },
  },
  footer: { socials: { github: 'https://github.com/acme', x: 'https://x.com/acme' } },
  navigation: {
    tabs: [
      {
        tab: 'Guides',
        groups: [{ group: 'Getting started', pages: ['index', 'quickstart', { group: 'Advanced', pages: ['guides/advanced/config'] }] }],
      },
      { tab: 'API', pages: ['api/overview'] },
    ],
    global: { anchors: [{ anchor: 'Community', href: 'https://discord.gg/acme', icon: 'discord' }] },
  },
};

/** mint.json (legacy schema) fixture: flat group array + topbar/tabs/anchors/footerSocials. */
const mintJson = {
  name: 'Legacy Docs',
  colors: { primary: '#0D9373' },
  logo: 'https://cdn.legacy.dev/logo.svg',
  favicon: 'https://cdn.legacy.dev/favicon.ico',
  topbarLinks: [{ name: 'Blog', url: 'https://legacy.dev/blog' }],
  topbarCtaButton: { name: 'Sign up', url: 'https://app.legacy.dev' },
  tabs: [{ name: 'API Reference', url: 'api-reference' }],
  anchors: [{ name: 'Community', icon: 'slack', url: 'https://slack.com/legacy' }],
  navigation: [
    { group: 'Home', pages: ['introduction', { group: 'Setup', pages: ['setup/install', 'setup/configure'] }] },
    { group: 'API', pages: ['api/auth'] },
  ],
  footerSocials: { twitter: 'https://twitter.com/legacy', github: 'https://github.com/legacy' },
};

const group = (node: NavNode): NavGroupNode => {
  if (node.kind !== 'group') {
    throw new Error(`Expected a group, got ${node.kind}`);
  }
  return node;
};

describe('parseMintlifyNavigation', () => {
  it('maps docs.json tabs/groups/pages to an ordered nested tree', () => {
    const { nodes, warnings } = parseMintlifyNavigation(docsJson);
    expect(warnings).toEqual([]);
    expect(nodes).toHaveLength(2);

    const guides = group(nodes[0] as NavNode);
    expect(guides.title).toBe('Guides');
    expect(guides.origin).toBe('tab');
    const gettingStarted = group(guides.children[0] as NavNode);
    expect(gettingStarted.title).toBe('Getting started');
    expect(gettingStarted.children).toEqual([
      { kind: 'page', path: 'index' },
      { kind: 'page', path: 'quickstart' },
      { kind: 'group', title: 'Advanced', origin: 'group', icon: undefined, children: [{ kind: 'page', path: 'guides/advanced/config' }] },
    ]);

    const api = group(nodes[1] as NavNode);
    expect(api.title).toBe('API');
    expect(api.children).toEqual([{ kind: 'page', path: 'api/overview' }]);
  });

  it('maps mint.json navigation arrays with nested groups, preserving order', () => {
    const { nodes, warnings } = parseMintlifyNavigation(mintJson);
    expect(warnings).toEqual([]);
    expect(nodes.map((node) => group(node).title)).toEqual(['Home', 'API']);

    const home = group(nodes[0] as NavNode);
    expect(home.children[0]).toEqual({ kind: 'page', path: 'introduction' });
    const setup = group(home.children[1] as NavNode);
    expect(setup.title).toBe('Setup');
    expect(setup.children).toEqual([
      { kind: 'page', path: 'setup/install' },
      { kind: 'page', path: 'setup/configure' },
    ]);
  });

  it('warns on external links, empty groups, and missing navigation', () => {
    const withJunk = {
      navigation: [
        { group: 'Stuff', pages: ['https://example.com/external', 'real-page'] },
        { group: 'Empty', pages: [] },
      ],
    };
    const { nodes, warnings } = parseMintlifyNavigation(withJunk);
    expect(nodes).toHaveLength(1);
    expect(group(nodes[0] as NavNode).children).toEqual([{ kind: 'page', path: 'real-page' }]);
    expect(warnings.some((w) => w.includes('external'))).toBe(true);
    expect(warnings.some((w) => w.includes('"Empty"'))).toBe(true);

    const none = parseMintlifyNavigation({});
    expect(none.nodes).toEqual([]);
    expect(none.warnings).toHaveLength(1);
  });

  it('wraps version-scoped mint.json entries in per-version groups so same-titled groups stay separate', () => {
    const versioned = {
      navigation: [
        { group: 'Guides', version: 'v1', pages: ['v1/intro'] },
        { group: 'Guides', version: 'v2', pages: ['v2/intro'] },
        { group: 'Shared', pages: ['shared'] },
      ],
    };
    const { nodes, warnings } = parseMintlifyNavigation(versioned);
    expect(nodes).toHaveLength(3);

    const v1 = group(nodes[0] as NavNode);
    expect(v1.title).toBe('v1');
    expect(v1.origin).toBe('version');
    expect(v1.children.map((child) => group(child).title)).toEqual(['Guides']);
    expect(group(v1.children[0] as NavNode).children).toEqual([{ kind: 'page', path: 'v1/intro' }]);

    const v2 = group(nodes[1] as NavNode);
    expect(v2.title).toBe('v2');
    expect(group(v2.children[0] as NavNode).children).toEqual([{ kind: 'page', path: 'v2/intro' }]);

    expect(group(nodes[2] as NavNode).title).toBe('Shared');
    expect(warnings.some((w) => w.includes('v1, v2'))).toBe(true);
  });

  it('collects multiple entries of the same version under one synthetic group, in first-seen order', () => {
    const versioned = {
      navigation: [
        { group: 'A', version: 'v1', pages: ['a'] },
        { group: 'B', version: 'v2', pages: ['b'] },
        { group: 'C', version: 'v1', pages: ['c'] },
      ],
    };
    const { nodes } = parseMintlifyNavigation(versioned);
    expect(nodes.map((node) => group(node).title)).toEqual(['v1', 'v2']);
    expect(group(nodes[0] as NavNode).children.map((child) => group(child).title)).toEqual(['A', 'C']);
    expect(group(nodes[1] as NavNode).children.map((child) => group(child).title)).toEqual(['B']);
  });

  it('strips extensions and leading slashes from page paths', () => {
    const { nodes } = parseMintlifyNavigation({ navigation: [{ group: 'G', pages: ['/intro.mdx', './setup/install.md'] }] });
    expect(group(nodes[0] as NavNode).children).toEqual([
      { kind: 'page', path: 'intro' },
      { kind: 'page', path: 'setup/install' },
    ]);
  });

  it('preserves modern object page entries and their display metadata', () => {
    const { nodes, warnings } = parseMintlifyNavigation({
      navigation: { groups: [{ group: 'Guides', pages: [{ page: '/intro.mdx', label: 'Start here', icon: 'rocket', tag: 'New' }] }] },
    });
    expect(warnings).toEqual([]);
    expect(group(nodes[0] as NavNode).children).toEqual([{ kind: 'page', path: 'intro', title: 'Start here', icon: 'rocket', tag: 'New' }]);
  });
});

describe('parseMintlifyLanguages', () => {
  it('keeps localized trees separate and imports namespaced RTL metadata', () => {
    const result = parseMintlifyLanguages({
      navigation: {
        languages: [
          { language: 'en', default: true, groups: [{ group: 'Guides', 'x-nibleaf': { slug: 'guides' }, pages: ['intro'] }] },
          {
            language: 'ar',
            groups: [{ group: 'الأدلة', 'x-nibleaf': { slug: 'guides' }, pages: ['ar/intro'] }],
            'x-nibleaf': {
              label: 'العربية',
              translation: { name: 'توثيق Acme', description: 'مرجع Acme باللغة العربية' },
              config: { seo: { metaTitle: 'توثيق Acme', allowIndex: true }, search: { placeholder: 'ابحث في التوثيق' } },
            },
          },
        ],
      },
    });

    expect(result.warnings).toEqual([]);
    expect(result.languages).toHaveLength(2);
    expect(result.languages[0]).toMatchObject({ code: 'en', direction: 'LTR', isDefault: true, enabled: true });
    expect(result.languages[1]).toMatchObject({
      code: 'ar',
      label: 'العربية',
      direction: 'RTL',
      isDefault: false,
      translation: { name: 'توثيق Acme' },
      config: { search: { placeholder: 'ابحث في التوثيق' } },
    });
    expect(group(result.languages[1]?.nodes[0] as NavNode)).toMatchObject({ title: 'الأدلة', slug: 'guides' });
  });

  it('chooses the first declared language when no default is explicit', () => {
    const result = parseMintlifyLanguages({
      navigation: {
        languages: [
          { language: 'ar', pages: ['ar/intro'] },
          { language: 'en', pages: ['intro'] },
        ],
      },
    });
    expect(result.languages.map((language) => language.isDefault)).toEqual([true, false]);
  });

  it('recognizes RTL language and script subtags beyond the core Arabic locales', () => {
    const result = parseMintlifyLanguages({
      navigation: {
        languages: [
          { language: 'en', default: true, pages: ['intro'] },
          { language: 'ps', pages: ['ps/intro'] },
          { language: 'az-Arab', pages: ['az-Arab/intro'] },
        ],
      },
    });

    expect(result.languages.map(({ code, direction }) => ({ code, direction }))).toEqual([
      { code: 'en', direction: 'LTR' },
      { code: 'ps', direction: 'RTL' },
      { code: 'az-Arab', direction: 'RTL' },
    ]);
  });
});

describe('findMintlifyConfigPath', () => {
  it('prefers docs.json over mint.json, shallowest path first', () => {
    expect(findMintlifyConfigPath(['a/mint.json', 'docs/docs.json', 'docs.json'])).toBe('docs.json');
    expect(findMintlifyConfigPath(['nested/deep/docs.json', 'mint.json'])).toBe('nested/deep/docs.json');
    expect(findMintlifyConfigPath(['mint.json', 'src/mint.json'])).toBe('mint.json');
    expect(findMintlifyConfigPath(['readme.md'])).toBeNull();
  });
});

describe('mapMintlifyConfig', () => {
  it('maps docs.json chrome: colors, branding, navbar, tab hrefs from the imported tree, footer, name', () => {
    const { nodes } = parseMintlifyNavigation(docsJson);
    const { config, warnings } = mapMintlifyConfig(docsJson, nodes);
    expect(warnings).toEqual([]);
    expect(config.styling).toEqual({ primaryColor: '#16A34A' });
    expect(config.branding).toEqual({
      logoLight: 'https://cdn.acme.dev/logo/light.svg',
      logoDark: 'https://cdn.acme.dev/logo/dark.svg',
      favicon: 'https://cdn.acme.dev/favicon.png',
    });
    expect(config.navbar?.links).toEqual([{ label: 'Support', href: 'https://acme.dev/support', external: true }]);
    expect(config.navbar?.ctaLabel).toBe('Dashboard');
    expect(config.navbar?.ctaUrl).toBe('https://app.acme.dev');
    // docs.json tabs became groups, so their navbar hrefs point at the first imported page.
    expect(config.navbar?.tabs).toEqual([
      { label: 'Guides', href: '/guides/getting-started/index' },
      { label: 'API', href: '/api/overview' },
    ]);
    expect(config.navbar?.anchors).toEqual([{ label: 'Community', href: 'https://discord.gg/acme', icon: 'discord', external: true }]);
    expect(config.footer).toEqual({ github: 'https://github.com/acme', x: 'https://x.com/acme' });
    expect(config.seo).toEqual({ metaTitle: 'Acme Docs' });
  });

  it('maps mint.json chrome: string logo to both themes, topbar CTA, url tabs, twitter → x', () => {
    const { nodes } = parseMintlifyNavigation(mintJson);
    const { config } = mapMintlifyConfig(mintJson, nodes);
    expect(config.styling).toEqual({ primaryColor: '#0D9373' });
    expect(config.branding).toEqual({
      logoLight: 'https://cdn.legacy.dev/logo.svg',
      logoDark: 'https://cdn.legacy.dev/logo.svg',
      favicon: 'https://cdn.legacy.dev/favicon.ico',
    });
    expect(config.navbar?.links).toEqual([{ label: 'Blog', href: 'https://legacy.dev/blog', external: true }]);
    expect(config.navbar?.ctaLabel).toBe('Sign up');
    expect(config.navbar?.tabs).toEqual([{ label: 'API Reference', href: '/api-reference' }]);
    expect(config.navbar?.anchors).toEqual([{ label: 'Community', href: 'https://slack.com/legacy', icon: 'slack', external: true }]);
    expect(config.footer).toEqual({ x: 'https://twitter.com/legacy', github: 'https://github.com/legacy' });
    expect(config.seo).toEqual({ metaTitle: 'Legacy Docs' });
  });

  it('skips repo-relative logo/favicon paths with a single warning while absolute URLs flow through', () => {
    const { config, warnings } = mapMintlifyConfig(
      { logo: { light: '/logo/light.svg', dark: 'https://cdn.acme.dev/dark.svg' }, favicon: '/favicon.ico' },
      [],
    );
    expect(config.branding).toEqual({ logoDark: 'https://cdn.acme.dev/dark.svg' });
    expect(warnings.filter((w) => w.includes('Settings → Branding'))).toHaveLength(1);

    const stringLogo = mapMintlifyConfig({ logo: '/logo.svg' }, []);
    expect(stringLogo.config.branding).toBeUndefined();
    expect(stringLogo.warnings.filter((w) => w.includes('Settings → Branding'))).toHaveLength(1);
  });

  it('keeps repo-relative branding when the importer can resolve it to the source repository', () => {
    const { config, warnings } = mapMintlifyConfig({ logo: '/logo.svg', favicon: './favicon.png' }, [], {
      resolveRepoAsset: (path) => `https://raw.example${path.startsWith('/') ? path : `/${path.replace(/^\.\//, '')}`}`,
    });
    expect(config.branding).toEqual({
      logoLight: 'https://raw.example/logo.svg',
      logoDark: 'https://raw.example/logo.svg',
      favicon: 'https://raw.example/favicon.png',
    });
    expect(warnings).toEqual([]);
  });

  it('rejects invalid hex colors with a warning instead of failing', () => {
    const { config, warnings } = mapMintlifyConfig({ colors: { primary: 'rgb(1,2,3)' } }, []);
    expect(config.styling).toBeUndefined();
    expect(warnings.some((w) => w.includes('colors.primary'))).toBe(true);
  });
});

describe('mergeConfigPreservingExisting', () => {
  it('only fills keys that are currently empty and reports set vs kept', () => {
    const existing = { styling: { primaryColor: '#111111' }, navbar: { links: [] } };
    const incoming = {
      styling: { primaryColor: '#16A34A' },
      navbar: { links: [{ label: 'Support', href: 'https://acme.dev' }], ctaLabel: 'Dashboard' },
      branding: { favicon: '/favicon.png' },
    };
    const { merged, set, kept } = mergeConfigPreservingExisting(existing, incoming);
    expect(merged.styling?.primaryColor).toBe('#111111'); // user setting preserved
    expect(merged.navbar?.links).toEqual([{ label: 'Support', href: 'https://acme.dev' }]); // [] counts as empty
    expect(merged.navbar?.ctaLabel).toBe('Dashboard');
    expect(merged.branding?.favicon).toBe('/favicon.png');
    expect(set.sort()).toEqual(['branding.favicon', 'navbar.ctaLabel', 'navbar.links']);
    expect(kept).toEqual(['styling.primaryColor']);
  });

  it('handles a null existing config', () => {
    const { merged, set, kept } = mergeConfigPreservingExisting(null, { styling: { primaryColor: '#16A34A' } });
    expect(merged.styling?.primaryColor).toBe('#16A34A');
    expect(set).toEqual(['styling.primaryColor']);
    expect(kept).toEqual([]);
  });
});
