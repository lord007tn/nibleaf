import { describe, expect, it, vi } from 'vitest';
import { marketingFaqs } from '@/lib/marketing-faqs';

vi.mock('@/functions/marketing', () => ({ getGithubStarsFn: vi.fn(async () => 7) }));

import { Route } from './pricing';

type Loader = () => Promise<{ stars: number; faqs: { q: string; a: string }[] }>;
type Head = (input: { loaderData?: unknown }) => { scripts?: { children: string }[] };

describe('/pricing route', () => {
  const loader = Route.options.loader as unknown as Loader;
  const head = Route.options.head as unknown as Head;
  const types = (scripts: { children: string }[] = []) => scripts.map((script) => JSON.parse(script.children)['@type']);

  it('loads the FAQ with the page and renders it as FAQPage JSON-LD', async () => {
    const data = await loader();
    expect(data.stars).toBe(7);
    expect(data.faqs).toEqual(marketingFaqs);

    const scripts = head({ loaderData: data }).scripts;
    expect(types(scripts)).toEqual(['FAQPage', 'BreadcrumbList']);
    const faq = JSON.parse(scripts?.[0]?.children ?? '{}');
    expect(faq.mainEntity.map((entry: { name: string }) => entry.name)).toEqual(marketingFaqs.map((item) => item.q));
  });

  it('keeps the breadcrumb without loader data', () => {
    expect(types(head({}).scripts)).toEqual(['BreadcrumbList']);
  });
});
