// @vitest-environment jsdom
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { comparisons, roundups } from '@/lib/comparison-data';
import { marketingFaqs } from '@/lib/marketing-faqs';
import { marketingLlms, marketingLlmsFull, marketingPricingMarkdown } from '@/lib/marketing-llms';
import { PricingPage } from '../pricing';
import {
  availabilityNote,
  CAPABILITY_AVAILABILITY,
  compareReleases,
  heroAvailabilityNote,
  isRollingOut,
  ROLLOUT_WORDING,
  type RolloutCapability,
} from './availability';
import { landingAr } from './landing.ar';
import { landingEn } from './landing.en';
import { LANDING_META } from './landing-meta';
import { USE_CASE_META, USE_CASES_TEASER } from './use-case-meta';
import { useCasesAr, useCasesTeaserAr } from './use-cases.ar';
import { useCasesEn, useCasesTeaserEn } from './use-cases.en';

/** The repository root, found from the working directory (vitest runs in `apps/app`). */
const repoRoot = (() => {
  let dir = process.cwd();
  while (!existsSync(path.join(dir, 'release/self-host.json'))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('release/self-host.json not found above the working directory');
    dir = parent;
  }
  return dir;
})();
const copyDir = 'apps/app/src/components/marketing/copy';
const capabilities = Object.keys(CAPABILITY_AVAILABILITY) as RolloutCapability[];

describe('capability availability follows the installer-pinned release', () => {
  const pinned = (JSON.parse(readFileSync(path.join(repoRoot, 'release/self-host.json'), 'utf8')) as { version: string }).version;

  it.each(capabilities)('%s is at least released once the pinned release contains it, and never ahead of it', (capability) => {
    const { availability, selfHostedSince } = CAPABILITY_AVAILABILITY[capability];
    if (selfHostedSince && compareReleases(selfHostedSince, pinned) <= 0) {
      expect(['released', 'live'], `${capability} shipped in ${selfHostedSince}; release/self-host.json pins ${pinned}`).toContain(availability);
    } else {
      expect(availability, `${capability} is not in a published release (pinned: ${pinned})`).toBe('in-source');
    }
  });

  it('orders release tags numerically', () => {
    expect(compareReleases('v0.2.1', 'v0.2.1')).toBe(0);
    expect(compareReleases('v0.2.1', 'v0.10.0')).toBeLessThan(0);
    expect(compareReleases('v1.0.0', 'v0.9.9')).toBeGreaterThan(0);
  });
});

/** Marketing copy files that must never hard-code rollout wording; it belongs in `availability.ts`. */
const copySources = [
  ...readdirSync(path.join(repoRoot, copyDir))
    .filter((file) => /\.tsx?$/.test(file) && !file.includes('.test.') && file !== 'availability.ts')
    .map((file) => `${copyDir}/${file}`),
  'apps/app/src/components/marketing/cloud-page.tsx',
  'apps/app/src/components/marketing/pricing.tsx',
  'apps/app/src/components/marketing/comparison-page.tsx',
  'apps/app/src/lib/comparison-data.ts',
  'apps/app/src/lib/marketing-faqs.ts',
  'apps/app/src/lib/marketing-llms.ts',
  'apps/app/src/lib/blog-manifest.ts',
];

/** Source text without comments, which may describe the rollout mechanism itself. */
const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Rendered copy with every note that is allowed right now (capabilities below `live`) taken out. */
const withoutAllowedNotes = (text: string) =>
  capabilities
    .filter(isRollingOut)
    .flatMap((capability) => [availabilityNote(capability, 'en'), availabilityNote(capability, 'ar')])
    .reduce((rest, note) => rest.split(note).join(''), text);

describe('marketing copy says "rolling out" only for capabilities that are', () => {
  it.each(copySources)('%s hard-codes no rollout wording', (file) => {
    const source = withoutComments(readFileSync(path.join(repoRoot, file), 'utf8'));
    expect(source.match(ROLLOUT_WORDING)?.[0], file).toBeUndefined();
  });

  const messagesDir = path.join(repoRoot, 'packages/i18n/messages');
  const locales = readdirSync(messagesDir).filter((file) => file.endsWith('.json'));

  it('covers all 12 interface locales', () => {
    expect(locales).toHaveLength(12);
  });

  it.each(locales)('%s marketing messages carry no rollout wording', (file) => {
    const messages = JSON.parse(readFileSync(path.join(messagesDir, file), 'utf8')) as Record<string, unknown>;
    const hits = Object.entries(messages).filter(
      ([key, value]) => key.startsWith('marketing') && typeof value === 'string' && ROLLOUT_WORDING.test(value),
    );
    expect(hits.map(([key]) => key)).toEqual([]);
  });

  it('derived landing, use-case, pricing, comparison and llms.txt copy shows rollout wording only for capabilities below live', () => {
    const rendered = [
      JSON.stringify([
        landingEn,
        landingAr,
        LANDING_META,
        useCasesEn,
        useCasesAr,
        useCasesTeaserEn,
        useCasesTeaserAr,
        USE_CASE_META,
        USE_CASES_TEASER,
      ]),
      JSON.stringify([comparisons, roundups, marketingFaqs]),
      renderToStaticMarkup(<PricingPage />),
      ...[marketingLlms, marketingLlmsFull, marketingPricingMarkdown].map((render) => render('https://nibleaf.example')),
    ].join('\n');
    expect(withoutAllowedNotes(rendered).match(ROLLOUT_WORDING)?.[0]).toBeUndefined();
  });

  it('drops the hero caption once every AI capability is live', () => {
    const live = (['askAi', 'docsInsights', 'supportMcp'] as const).every((capability) => !isRollingOut(capability));
    for (const lang of ['en', 'ar'] as const) {
      if (live) expect(heroAvailabilityNote(lang)).toBeUndefined();
      else expect(heroAvailabilityNote(lang)).toMatch(ROLLOUT_WORDING);
    }
  });
});
