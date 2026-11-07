import { describe, expect, it, vi } from 'vitest';
import { marketingFaqs } from '@/lib/marketing-faqs';

vi.mock('@/functions/marketing', () => ({ getGithubStarsFn: vi.fn(async () => 7) }));

import { Route } from './pricing';

type Head = { scripts?: { children: string }[] };
type Loader = () => Promise<{ stars: number; head: Head }>;
type HeadOption = (input: { loaderData?: unknown }) => Head;

describe('/pricing route', () => {
  const loader = Route.options.loader as unknown as Loader;
  const head = Route.options.head as unknown as HeadOption;
  const types = (scripts: { children: string }[] = []) => scripts.map((script) => JSON.parse(script.children)['@type']);

  it('builds the FAQPage JSON-LD in the loader, from the FAQ the page renders', async () => {
    const data = await loader();
    expect(data.stars).toBe(7);

    const scripts = head({ loaderData: data }).scripts;
    expect(types(scripts)).toEqual(['FAQPage', 'BreadcrumbList']);
    const faq = JSON.parse(scripts?.[0]?.children ?? '{}');
    expect(faq.mainEntity.map((entry: { name: string }) => entry.name)).toEqual(marketingFaqs.map((item) => item.q));
  });
});
