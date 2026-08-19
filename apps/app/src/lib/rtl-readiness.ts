export const RTL_RUBRIC_VERSION = '0.1.0';

export type RtlCheckStatus = 'pass' | 'fail' | 'unknown';

export interface RtlReadinessCheck {
  actual: string;
  category: string;
  expected: string;
  id: string;
  reproduction: string;
  status: RtlCheckStatus;
  weight: number;
}

export interface RtlReadinessCategory {
  id: string;
  label: string;
  knownWeight: number;
  passedWeight: number;
  score: number | null;
  totalWeight: number;
  unknownChecks: number;
}

export interface RtlReadinessResult {
  band: 'strong evidence' | 'work remaining' | 'material gaps' | 'insufficient evidence';
  categories: RtlReadinessCategory[];
  checks: RtlReadinessCheck[];
  checksRun: number;
  checksUnknown: number;
  coverage: number;
  rubricVersion: string;
  score: number | null;
}

interface CheckDefinition {
  category: string;
  expected: string;
  id: string;
  reproduction: string;
  run: (document: Document, source: string) => Pick<RtlReadinessCheck, 'actual' | 'status'>;
  weight: number;
}

const CATEGORIES = [
  { id: 'language-direction', label: 'Language and document direction', weight: 12 },
  { id: 'language-seo', label: 'Language architecture and SEO', weight: 12 },
  { id: 'mixed-direction', label: 'Mixed-direction prose and code', weight: 16 },
  { id: 'navigation', label: 'Navigation and directional UI', weight: 12 },
  { id: 'search', label: 'Documentation search', weight: 16 },
  { id: 'tables-media-api', label: 'Tables, media, and API reference', weight: 10 },
  { id: 'keyboard-semantics', label: 'Keyboard, focus, and semantics', weight: 10 },
  { id: 'mobile-layout', label: 'Mobile rendered layout', weight: 12 },
] as const;

const ARABIC = /[\u0600-\u06ff]/u;
const LATIN_OR_TECHNICAL = /[A-Za-z]|(?:https?:\/\/)|(?:\/[\w-]+)|(?:--?[a-z])/u;

const pass = (actual: string) => ({ actual, status: 'pass' as const });
const fail = (actual: string) => ({ actual, status: 'fail' as const });
const unknown = (actual: string) => ({ actual, status: 'unknown' as const });

const styleText = (document: Document) => [...document.querySelectorAll('style')].map((node) => node.textContent ?? '').join('\n');
const normalizedStyle = (value: string) => value.toLowerCase().replace(/\s+/g, ' ');
const hasDirectionRule = (value: string, selectorHint: 'code' | 'pre') => {
  const css = normalizedStyle(value);
  const relevant = css
    .split('}')
    .filter((rule) => rule.includes(selectorHint))
    .join('}');
  return /direction\s*:\s*ltr/u.test(relevant);
};
const hasIsolationRule = (value: string) => {
  const css = normalizedStyle(value);
  const relevant = css
    .split('}')
    .filter((rule) => rule.includes('code') || rule.includes('bdi'))
    .join('}');
  return /unicode-bidi\s*:\s*(?:isolate|isolate-override)/u.test(relevant);
};
const inlineDeclares = (element: Element, property: string, value: string) => {
  const attribute = element.getAttribute(property);
  const style = normalizedStyle(element.getAttribute('style') ?? '');
  return attribute?.toLowerCase() === value || style.includes(`${property}: ${value}`) || style.includes(`${property}:${value}`);
};
const metaContent = (document: Document, selector: string) => document.querySelector(selector)?.getAttribute('content')?.trim() ?? '';

const CHECKS: CheckDefinition[] = [
  {
    id: 'root-language',
    category: 'language-direction',
    weight: 4,
    expected: 'The root document declares an Arabic language tag such as ar or ar-SA.',
    reproduction: 'Inspect the initial HTML element and read its lang attribute.',
    run: (document) => {
      const language = document.documentElement.getAttribute('lang')?.trim() ?? '';
      if (!language) return fail('The root html element has no lang attribute.');
      return /^ar(?:-|$)/iu.test(language) ? pass(`Root lang is ${language}.`) : fail(`Root lang is ${language}, not Arabic.`);
    },
  },
  {
    id: 'root-direction',
    category: 'language-direction',
    weight: 4,
    expected: 'The Arabic document declares dir="rtl" on the root or an equivalent Arabic content root.',
    reproduction: 'Inspect html and the main Arabic content container before JavaScript changes the DOM.',
    run: (document) => {
      const root = document.documentElement.getAttribute('dir')?.toLowerCase();
      if (root === 'rtl') return pass('Root dir is rtl.');
      const rtlMain = document.querySelector('main[dir="rtl"], [lang^="ar"][dir="rtl"]');
      return rtlMain ? pass('An Arabic content root declares dir="rtl".') : fail(`No RTL content root was found; root dir is ${root || 'missing'}.`);
    },
  },
  {
    id: 'ltr-islands',
    category: 'language-direction',
    weight: 4,
    expected: 'Technical code or path islands inside Arabic prose explicitly preserve LTR direction.',
    reproduction: 'Inspect inline code and preformatted examples inside Arabic content.',
    run: (document, source) => {
      const code = [...document.querySelectorAll('code')];
      if (code.length === 0) return unknown('No code sample exists in the submitted HTML.');
      const css = styleText(document) || source;
      const declared = code.some((element) => inlineDeclares(element, 'dir', 'ltr')) || hasDirectionRule(css, 'code');
      return declared ? pass('Code declares LTR direction through markup or CSS.') : fail('Code exists, but no LTR direction rule was detected.');
    },
  },
  {
    id: 'canonical',
    category: 'language-seo',
    weight: 3,
    expected: 'The document exposes one absolute canonical URL.',
    reproduction: 'Inspect link[rel="canonical"] in the initial head.',
    run: (document) => {
      const canonicals = [...document.querySelectorAll('link[rel="canonical"]')].map((link) => link.getAttribute('href') ?? '').filter(Boolean);
      if (canonicals.length !== 1) return fail(`Found ${canonicals.length} canonical links.`);
      return /^https:\/\//u.test(canonicals[0] ?? '')
        ? pass(`Canonical is ${canonicals[0]}.`)
        : fail(`Canonical is not absolute HTTPS: ${canonicals[0]}.`);
    },
  },
  {
    id: 'hreflang-set',
    category: 'language-seo',
    weight: 5,
    expected: 'The page exposes self-consistent Arabic, English, and x-default alternate links.',
    reproduction: 'Inspect link[rel="alternate"][hreflang] and verify the reciprocal sibling separately.',
    run: (document) => {
      const alternates = new Map(
        [...document.querySelectorAll('link[rel="alternate"][hreflang]')].map((link) => [
          link.getAttribute('hreflang')?.toLowerCase() ?? '',
          link.getAttribute('href') ?? '',
        ]),
      );
      const missing = ['ar', 'en', 'x-default'].filter((key) => !alternates.get(key));
      return missing.length === 0
        ? pass('Arabic, English, and x-default alternates are present; reciprocal pages still require a separate check.')
        : fail(`Missing alternate links for: ${missing.join(', ')}.`);
    },
  },
  {
    id: 'arabic-metadata',
    category: 'language-seo',
    weight: 4,
    expected: 'The title and description contain Arabic text and Open Graph identifies an Arabic locale.',
    reproduction: 'Inspect title, meta description, and og:locale in the initial response.',
    run: (document) => {
      const title = document.title.trim();
      const description = metaContent(document, 'meta[name="description"]');
      const locale = metaContent(document, 'meta[property="og:locale"]');
      const failures = [
        !ARABIC.test(title) && 'title',
        !ARABIC.test(description) && 'description',
        !/^ar(?:_|-|$)/iu.test(locale) && 'og:locale',
      ].filter(Boolean);
      return failures.length === 0
        ? pass(`Arabic title/description and locale ${locale} are present.`)
        : fail(`Arabic metadata is incomplete: ${failures.join(', ')}.`);
    },
  },
  {
    id: 'inline-code-isolation',
    category: 'mixed-direction',
    weight: 6,
    expected: 'Inline technical text is LTR and isolated from the surrounding RTL sentence.',
    reproduction: 'Inspect inline code styles for direction:ltr and unicode-bidi:isolate, then copy a sample into a terminal.',
    run: (document, source) => {
      const inline = [...document.querySelectorAll('code')].filter((element) => element.parentElement?.tagName !== 'PRE');
      if (inline.length === 0) return unknown('No inline code sample exists.');
      const css = styleText(document) || source;
      const direction = inline.some((element) => inlineDeclares(element, 'dir', 'ltr')) || hasDirectionRule(css, 'code');
      const isolation = inline.some((element) => /isolate/u.test(normalizedStyle(element.getAttribute('style') ?? ''))) || hasIsolationRule(css);
      return direction && isolation
        ? pass('Inline code has LTR direction and bidi isolation evidence.')
        : fail(`Inline code evidence is incomplete: direction=${direction}, isolation=${isolation}.`);
    },
  },
  {
    id: 'block-code-direction',
    category: 'mixed-direction',
    weight: 4,
    expected: 'Code blocks use LTR direction and left text alignment.',
    reproduction: 'Inspect pre/code markup and rendered styles.',
    run: (document, source) => {
      const blocks = [...document.querySelectorAll('pre')];
      if (blocks.length === 0) return unknown('No block code sample exists.');
      const css = normalizedStyle(styleText(document) || source);
      const direction = blocks.some((element) => inlineDeclares(element, 'dir', 'ltr')) || hasDirectionRule(css, 'pre');
      const alignment =
        blocks.some((element) => normalizedStyle(element.getAttribute('style') ?? '').includes('text-align:left')) ||
        /pre[^}]*text-align\s*:\s*left/u.test(css);
      return direction && alignment
        ? pass('Code blocks have LTR direction and left alignment evidence.')
        : fail(`Block code evidence is incomplete: direction=${direction}, left alignment=${alignment}.`);
    },
  },
  {
    id: 'mixed-sample',
    category: 'mixed-direction',
    weight: 3,
    expected: 'The page includes at least one Arabic/technical mixed-direction test sample.',
    reproduction: 'Find a sentence containing Arabic prose plus a command, URL, path, version, or Latin identifier.',
    run: (document) => {
      const candidates = [...document.querySelectorAll('p, li, blockquote')].map((element) => element.textContent ?? '');
      return candidates.some((text) => ARABIC.test(text) && LATIN_OR_TECHNICAL.test(text))
        ? pass('A mixed Arabic/technical sample is present.')
        : unknown('No mixed Arabic/technical sample was found to exercise bidi behavior.');
    },
  },
  {
    id: 'bidi-markup',
    category: 'mixed-direction',
    weight: 3,
    expected: 'Mixed-direction content uses bdi/bdo or equivalent unicode-bidi isolation.',
    reproduction: 'Inspect mixed text markup and CSS isolation rules.',
    run: (document, source) => {
      if (document.querySelector('bdi, bdo')) return pass('The document uses bdi or bdo markup.');
      return hasIsolationRule(styleText(document) || source)
        ? pass('CSS supplies unicode-bidi isolation for technical content.')
        : unknown('No bdi/bdo element or equivalent isolation rule was detected.');
    },
  },
  {
    id: 'navigation-landmark',
    category: 'navigation',
    weight: 3,
    expected: 'Primary documentation navigation uses a labelled nav landmark.',
    reproduction: 'Inspect nav elements and their aria-label or aria-labelledby attributes.',
    run: (document) => {
      const navs = [...document.querySelectorAll('nav')];
      if (navs.length === 0) return fail('No nav landmark exists.');
      return navs.some((nav) => nav.hasAttribute('aria-label') || nav.hasAttribute('aria-labelledby'))
        ? pass('A labelled nav landmark is present.')
        : fail('Navigation exists but is not labelled.');
    },
  },
  {
    id: 'breadcrumbs',
    category: 'navigation',
    weight: 3,
    expected: 'Breadcrumb navigation is labelled and exposes an ordered path.',
    reproduction: 'Inspect the breadcrumb nav and verify its visible order in RTL.',
    run: (document) => {
      const breadcrumb = document.querySelector('[aria-label*="breadcrumb" i], [data-breadcrumb]');
      if (!breadcrumb) return unknown('No breadcrumb component was found.');
      return breadcrumb.querySelectorAll('a').length > 0
        ? pass('A labelled breadcrumb path is present.')
        : fail('Breadcrumb markup has no linked path.');
    },
  },
  {
    id: 'directional-navigation-render',
    category: 'navigation',
    weight: 6,
    expected: 'Previous/next semantics, icons, and sidebar position are correct in the rendered RTL interface.',
    reproduction: 'Open the page in a browser, traverse previous/next links, and compare icon meaning at desktop and mobile sizes.',
    run: () => unknown('Static HTML cannot prove rendered icon direction or sidebar mirroring.'),
  },
  {
    id: 'search-interface',
    category: 'search',
    weight: 4,
    expected: 'A labelled documentation-search input or dialog is discoverable.',
    reproduction: 'Find the search control and open it with pointer and keyboard.',
    run: (document) => {
      const control = document.querySelector('input[type="search"], [role="searchbox"], [role="search"] input, button[aria-label*="search" i]');
      if (!control) return fail('No labelled search control was detected.');
      const label = control.getAttribute('aria-label') || control.getAttribute('placeholder') || control.textContent || '';
      return label.trim() ? pass(`Search control label is "${label.trim()}".`) : fail('The search control has no accessible label or placeholder.');
    },
  },
  {
    id: 'arabic-search-prompt',
    category: 'search',
    weight: 4,
    expected: 'The Arabic search surface uses an Arabic label or placeholder.',
    reproduction: 'Inspect the active Arabic search control and its accessible name.',
    run: (document) => {
      const control = document.querySelector('input[type="search"], [role="searchbox"], [role="search"] input, button[aria-label*="search" i]');
      if (!control) return unknown('No search control exists to inspect.');
      const label = `${control.getAttribute('aria-label') ?? ''} ${control.getAttribute('placeholder') ?? ''} ${control.textContent ?? ''}`;
      return ARABIC.test(label) ? pass('The search prompt contains Arabic text.') : fail('The search prompt is not localized into Arabic.');
    },
  },
  {
    id: 'search-behavior',
    category: 'search',
    weight: 8,
    expected: 'Runtime tests cover normalization, conservative morphology, code protection, ranking, and zero-result behavior.',
    reproduction: 'Run the published search corpus against the live index and capture actual ranked results.',
    run: () => unknown('Static HTML cannot verify tokenizer, morphology, ranking, or zero-result behavior.'),
  },
  {
    id: 'table-overflow',
    category: 'tables-media-api',
    weight: 3,
    expected: 'Wide tables have an explicit horizontal-overflow strategy.',
    reproduction: 'Inspect table wrappers and render the page at 390 px.',
    run: (document, source) => {
      if (!document.querySelector('table')) return unknown('No table exists in the sample.');
      const css = normalizedStyle(styleText(document) || source);
      const wrapper = document.querySelector('[class*="overflow" i] table, [data-table-scroll] table');
      return wrapper || /table[^}]*overflow(?:-x)?\s*:\s*(?:auto|scroll)/u.test(css)
        ? pass('A table overflow strategy is present.')
        : fail('Tables exist without a detected overflow strategy.');
    },
  },
  {
    id: 'media-alternatives',
    category: 'tables-media-api',
    weight: 3,
    expected: 'Meaningful media has non-empty alternative text and figures have useful captions.',
    reproduction: 'Inspect every image, figure, and diagram in the Arabic page.',
    run: (document) => {
      const images = [...document.querySelectorAll('img')];
      if (images.length === 0) return unknown('No images exist in the sample.');
      const missing = images.filter((image) => !image.getAttribute('alt')?.trim()).length;
      return missing === 0
        ? pass(`All ${images.length} images have alternative text.`)
        : fail(`${missing} of ${images.length} images have empty or missing alt text.`);
    },
  },
  {
    id: 'code-samples',
    category: 'tables-media-api',
    weight: 2,
    expected: 'Technical documentation includes a copyable code sample where the task requires one.',
    reproduction: 'Locate a pre/code sample and copy it into a plain-text editor.',
    run: (document) => (document.querySelector('pre code') ? pass('A block code sample is present.') : unknown('No block code sample exists.')),
  },
  {
    id: 'api-controls-render',
    category: 'tables-media-api',
    weight: 2,
    expected: 'API try-it controls, tabs, and response panes remain usable in RTL.',
    reproduction: 'Render an API-reference fixture, change tabs, enter a request, and inspect response direction.',
    run: () => unknown('Static HTML cannot prove API-control interaction behavior.'),
  },
  {
    id: 'document-landmarks',
    category: 'keyboard-semantics',
    weight: 3,
    expected: 'The page exposes main and navigation landmarks.',
    reproduction: 'Use a landmark list in browser accessibility tools.',
    run: (document) =>
      document.querySelector('main') && document.querySelector('nav')
        ? pass('Main and nav landmarks are present.')
        : fail('Main and nav landmarks are not both present.'),
  },
  {
    id: 'control-labels',
    category: 'keyboard-semantics',
    weight: 3,
    expected: 'Form controls and icon-only buttons have accessible names.',
    reproduction: 'Inspect the accessibility tree for every button, input, select, and textarea.',
    run: (document) => {
      const controls = [...document.querySelectorAll('button, input, select, textarea')];
      if (controls.length === 0) return unknown('No interactive controls exist in the sample.');
      const labels = new Set([...document.querySelectorAll('label[for]')].map((label) => label.getAttribute('for')));
      const unnamed = controls.filter((control) => {
        const text = control.textContent?.trim();
        const id = control.getAttribute('id');
        return !(
          text ||
          control.getAttribute('aria-label') ||
          control.getAttribute('aria-labelledby') ||
          control.getAttribute('title') ||
          (id && labels.has(id))
        );
      });
      return unnamed.length === 0
        ? pass(`All ${controls.length} controls have naming evidence.`)
        : fail(`${unnamed.length} of ${controls.length} controls appear unnamed.`);
    },
  },
  {
    id: 'skip-link',
    category: 'keyboard-semantics',
    weight: 2,
    expected: 'A keyboard user can skip repeated navigation and reach main content.',
    reproduction: 'Press Tab from the top of the page and activate the skip link.',
    run: (document) => {
      const link = [...document.querySelectorAll('a[href^="#"]')].find((candidate) => /skip|تخط/u.test(candidate.textContent ?? ''));
      return link ? pass(`Skip link targets ${link.getAttribute('href')}.`) : fail('No skip-to-content link was detected.');
    },
  },
  {
    id: 'focus-order-render',
    category: 'keyboard-semantics',
    weight: 2,
    expected: 'Focus order is logical and focus remains visible in the rendered interface.',
    reproduction: 'Traverse every interactive control with Tab and Shift+Tab at desktop and mobile widths.',
    run: () => unknown('Static HTML cannot prove focus order or visible focus.'),
  },
  {
    id: 'viewport',
    category: 'mobile-layout',
    weight: 4,
    expected: 'The document sets a responsive viewport.',
    reproduction: 'Inspect meta[name="viewport"] in the initial head.',
    run: (document) => {
      const viewport = metaContent(document, 'meta[name="viewport"]');
      return /width\s*=\s*device-width/iu.test(viewport)
        ? pass(`Viewport is "${viewport}".`)
        : fail(`Responsive viewport is missing or incomplete: "${viewport}".`);
    },
  },
  {
    id: 'responsive-rules',
    category: 'mobile-layout',
    weight: 3,
    expected: 'The page includes narrow-screen layout rules or responsive utility evidence.',
    reproduction: 'Inspect CSS media queries or responsive class output, then render at 390 px.',
    run: (document, source) => {
      const css = styleText(document) || source;
      const classes = [...document.querySelectorAll('[class]')].map((element) => element.getAttribute('class') ?? '').join(' ');
      return /@media\s*\(/u.test(css) || /(?:sm|md|lg|xl):[\w-]+/u.test(classes)
        ? pass('Responsive-rule evidence is present.')
        : unknown('No media query or recognizable responsive utility was found in the submitted HTML.');
    },
  },
  {
    id: 'mobile-render',
    category: 'mobile-layout',
    weight: 5,
    expected: 'At 390 px there is no page-level horizontal overflow and navigation, search, tables, and mixed text remain usable.',
    reproduction: 'Render at 390×844, inspect scrollWidth/clientWidth, and exercise sticky navigation and search.',
    run: () => unknown('Static HTML cannot prove rendered mobile overflow or interaction behavior.'),
  },
];

export function gradeRtlDocument(document: Document, source = ''): RtlReadinessResult {
  const checks = CHECKS.map(
    (definition): RtlReadinessCheck => ({
      ...definition,
      ...definition.run(document, source),
    }),
  );
  const known = checks.filter((check) => check.status !== 'unknown');
  const knownWeight = known.reduce((sum, check) => sum + check.weight, 0);
  const passedWeight = known.filter((check) => check.status === 'pass').reduce((sum, check) => sum + check.weight, 0);
  const score = knownWeight > 0 ? Math.round((passedWeight / knownWeight) * 100) : null;
  const coverage = Math.round(knownWeight);
  const band =
    coverage < 60 || score === null ? 'insufficient evidence' : score >= 85 ? 'strong evidence' : score >= 65 ? 'work remaining' : 'material gaps';
  const categories = CATEGORIES.map((category): RtlReadinessCategory => {
    const categoryChecks = checks.filter((check) => check.category === category.id);
    const categoryKnown = categoryChecks.filter((check) => check.status !== 'unknown');
    const categoryKnownWeight = categoryKnown.reduce((sum, check) => sum + check.weight, 0);
    const categoryPassedWeight = categoryKnown.filter((check) => check.status === 'pass').reduce((sum, check) => sum + check.weight, 0);
    return {
      id: category.id,
      label: category.label,
      knownWeight: categoryKnownWeight,
      passedWeight: categoryPassedWeight,
      score: categoryKnownWeight > 0 ? Math.round((categoryPassedWeight / categoryKnownWeight) * 100) : null,
      totalWeight: category.weight,
      unknownChecks: categoryChecks.filter((check) => check.status === 'unknown').length,
    };
  });
  return {
    band,
    categories,
    checks,
    checksRun: known.length,
    checksUnknown: checks.length - known.length,
    coverage,
    rubricVersion: RTL_RUBRIC_VERSION,
    score,
  };
}

export function parseAndGradeRtlHtml(html: string, parse: (source: string) => Document): RtlReadinessResult {
  return gradeRtlDocument(parse(html), html);
}
