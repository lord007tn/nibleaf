// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import RichMarkdown from '../markdown-rich';

/** Mintlify props rendered through the real reader pipeline (pre-parse → sanitize → lazy renderers). */
const render = (content: string, lang?: string) =>
  renderToStaticMarkup(createElement(RichMarkdown, { content, ...(lang ? { site: { projectId: 'p1', lang } } : {}) }));
const block = (tag: string, attributes: string, body = 'Body text.') => `<${tag} ${attributes}>\n\n${body}\n\n</${tag}>`;

describe('Mintlify props in the reader', () => {
  it('renders a custom Callout icon and color without leaking the raw values into markup', () => {
    const html = render(block('Callout', 'type="tip" icon="rocket" color="#FFC107"'));
    expect(html).toContain('--callout-color:#FFC107');
    expect(html).toContain('lucide-rocket');
    expect(render(block('Callout', 'color="red;background:url(x)"'))).not.toContain('url(x)');
  });

  it('renders Card horizontal, image, CTA, arrow and icon color', () => {
    const html = render(
      block('Card', 'title="Guide" href="/guide" icon="book" horizontal img="/cover.png" cta="Read the guide" arrow color="#ff0000"'),
    );
    expect(html).toContain('<img src="/cover.png" alt="Guide"');
    expect(html).toContain('Read the guide');
    expect(html).toContain('lucide-arrow-up-right');
    expect(html).toContain('color:#ff0000');
    expect(html).toContain('flex items-start gap-3');
  });

  it('reads literal JSX props (cols={3}) and falls back to the child count for Columns', () => {
    expect(render('<Columns cols={3}>\n\n<Column>\n\nA\n\n</Column>\n\n</Columns>')).toContain('md:grid-cols-3');
    const twoChildren = '<Columns>\n\n<Column>\n\nA\n\n</Column>\n\n<Column>\n\nB\n\n</Column>\n\n</Columns>';
    expect(render(twoChildren)).toContain('md:grid-cols-2');
    expect(render(`<CardGroup cols={3}>\n\n<Card title="A">\n\nA\n\n</Card>\n\n</CardGroup>`)).toContain('sm:grid-cols-3');
  });

  it('renders Tabs defaultTabIndex, borderBottom, tab icons and anchors', () => {
    const html = render(
      `<Tabs defaultTabIndex={1} borderBottom>\n\n<Tab title="npm" icon="package">\n\nnpm i\n\n</Tab>\n\n<Tab title="pnpm" id="pnpm-install">\n\npnpm add\n\n</Tab>\n\n</Tabs>`,
    );
    expect(html).toMatch(/id="pnpm-install"[^>]*aria-selected="true"/);
    expect(html).toContain('lucide-package');
    expect(html).toContain('border-b pb-5');
  });

  it('renders Accordion description, icon and anchor', () => {
    const html = render(block('Accordion', 'title="Setup" description="Takes two minutes" icon="rocket" id="setup"'));
    expect(html).toContain('id="setup"');
    expect(html).toContain('Takes two minutes');
    expect(html).toContain('lucide-rocket');
  });

  it('renders Steps title sizes, step icons and numbers', () => {
    const html = render(
      `<Steps titleSize="h3">\n\n<Step title="Install" stepNumber={4}>\n\nRun it.\n\n</Step>\n\n<Step title="Ship" icon="rocket" titleSize="h2">\n\nDone.\n\n</Step>\n\n</Steps>`,
    );
    expect(html).toMatch(/<li[^>]*value="4"[^>]*style="counter-set:reader-step 4"/);
    expect(html).toContain('<h3 class="mt-0 mb-1.5 font-semibold text-lg">Install</h3>');
    expect(html).toContain('<h2 class="mt-0 mb-2 font-semibold text-xl">Ship</h2>');
    expect(html).toContain('data-step-icon=""');
  });

  it('renders Tooltip headline and call to action', () => {
    const html = render('Use <Tooltip tip="Short for API key" headline="Key" cta="Learn more" href="https://example.com/keys">keys</Tooltip>.');
    expect(html).toContain('<strong class="block font-semibold">Key</strong>');
    expect(html).toContain('href="https://example.com/keys"');
    expect(html).toContain('Learn more');
  });

  it('renders Badge sizes, shapes, icons, outline and dimmed state with named colors', () => {
    const html = render('<Badge color="green" size="lg" shape="pill" icon="check" stroke disabled>Live</Badge>');
    expect(html).toContain('--badge-tone:var(--theme-success,#16a34a)');
    expect(html).toContain('rounded-full');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('lucide-check');
    expect(html).toContain('background:transparent');
    expect(render('<Badge disabled={false}>Live</Badge>')).not.toContain('aria-disabled');
    expect(render('<Badge color="surface-destructive">Down</Badge>')).toContain('--badge-tone:var(--theme-danger,var(--destructive))');
  });

  it('renders the Frame hint before the frame', () => {
    const html = render(block('Frame', 'hint="Look at the corner" caption="Dashboard"', '![Dashboard](/d.png)'));
    expect(html.indexOf('Look at the corner')).toBeLessThan(html.indexOf('<figure'));
  });

  it('renders ParamField placeholder and pre/post labels, and ResponseField labels', () => {
    const html = render(block('ParamField', 'query="limit" type="number" placeholder="10" pre={["GET"]} post={["beta"]} required={false}'));
    expect(html).toContain('GET');
    expect(html).toContain('beta');
    expect(html).toContain('Placeholder: <code class="font-mono">10</code>');
    expect(html).not.toContain('required');
    expect(render(block('ResponseField', 'name="id" type="string" pre={["read-only"]}'))).toContain('read-only');
  });

  it('renders Update tags as a labelled list', () => {
    const html = render(block('Update', 'label="v2" description="Search" tags={["Feature", "Fix"]}'));
    expect(html).toContain('aria-label="Tags"');
    // Each tag keeps its own direction (an English tag on an Arabic page).
    expect(html).toContain('<li dir="auto" class="m-0 rounded-md bg-muted px-2 py-0.5 font-medium text-muted-foreground text-xs">Feature</li>');
  });

  it('localizes reader strings and keeps RTL-safe logical layout on Arabic pages', () => {
    const html = render(block('ParamField', 'query="limit" placeholder="10"'), 'ar');
    expect(html).not.toContain('Placeholder:');
    const update = render(block('Update', 'label="v2" tags={["ميزة"]}'), 'ar');
    expect(update).toContain('border-s ps-6');
    expect(update).toContain('ميزة');
    const card = render(block('Card', 'title="دليل" href="/guide" arrow'), 'ar');
    expect(card).toContain('rtl:-scale-x-100');
  });
});

/**
 * Which images the Frame's full-width rules reach. Each Tailwind arbitrary
 * variant on the frame body (`[&>img:not([width])]:w-full`) is turned back into
 * the selector it compiles to and run against the rendered frame.
 */
function fullWidthImages(html: string, dir: 'ltr' | 'rtl'): string[] {
  const host = document.createElement('div');
  host.dir = dir;
  host.innerHTML = html;
  document.body.append(host);
  const body = host.querySelector('figure > div');
  if (!body) throw new Error('no frame body');
  const selectors = body.className
    .split(/\s+/)
    .flatMap((name) => /^\[(.+)\]:w-full$/.exec(name)?.[1] ?? [])
    .map((variant) => variant.replaceAll('&', ':scope').replaceAll('_', ' '));
  expect(selectors.length).toBeGreaterThan(0);
  const stretched = new Set<Element>();
  for (const selector of selectors) {
    for (const element of body.querySelectorAll(selector)) {
      // A stretched zoom wrapper stretches its image too.
      stretched.add(element.matches('.reader-image') ? (element.querySelector('img') ?? element) : element);
    }
  }
  host.remove();
  return [...stretched].map((image) => image.getAttribute('alt') ?? '');
}

describe('Frame image sizes', () => {
  const frame = block(
    'Frame',
    'caption="Two images"',
    ['<img src="/sized.png" alt="Sized" width="480" />', '', '<img src="/plain.png" alt="Plain" />'].join('\n'),
  );

  it.each(['ltr', 'rtl'] as const)('keeps a resized image at its width and stretches the others (%s, editor preview)', (dir) => {
    const html = render(frame);
    expect(html).toMatch(/<img[^>]*width="480"/);
    expect(fullWidthImages(html, dir)).toEqual(['Plain']);
  });

  it.each([
    ['ltr', 'en'],
    ['rtl', 'ar'],
  ] as const)('does the same through the published reader’s zoomable images (%s)', (dir, lang) => {
    const html = render(frame, lang);
    expect(html).toContain('reader-image');
    expect(html).toMatch(/<img[^>]*width="480"/);
    expect(fullWidthImages(html, dir)).toEqual(['Plain']);
  });

  it('still never lets a resized image overflow the frame', () => {
    const html = render(frame);
    expect(html).toContain('[&amp;_img[width]]:max-w-full');
  });
});

describe('interactive Mintlify props', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.location.hash = '';
  });

  const tabs = (attributes = '') =>
    `<Tabs${attributes}>\n\n<Tab title="macOS">\n\nmac\n\n</Tab>\n\n<Tab title="Windows">\n\nwin\n\n</Tab>\n\n</Tabs>`;
  const selected = (group: Element) => group.querySelector('[role="tab"][aria-selected="true"]')?.textContent;

  it('switches tabs with matching titles together (sync is the default)', async () => {
    await act(async () => root.render(createElement(RichMarkdown, { content: `${tabs()}\n\n${tabs()}\n\n${tabs(' sync={false}')}` })));
    const groups = [...container.querySelectorAll('[role="tablist"]')];
    expect(groups).toHaveLength(3);
    const windows = groups[0]?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1];
    await act(async () => windows?.click());
    expect(selected(groups[0] as Element)).toBe('Windows');
    expect(selected(groups[1] as Element)).toBe('Windows');
    // An independent group (sync={false}) keeps its own choice.
    expect(selected(groups[2] as Element)).toBe('macOS');
  });

  it('opens the tab and accordion a link points at', async () => {
    window.location.hash = '#windows';
    await act(async () =>
      root.render(createElement(RichMarkdown, { content: `${tabs()}\n\n<Accordion title="FAQ" id="faq">\n\nAnswer\n\n</Accordion>` })),
    );
    expect(selected(container.querySelector('[role="tablist"]') as Element)).toBe('Windows');
    expect(container.querySelector('#faq section')?.hasAttribute('hidden')).toBe(true);
    await act(async () => {
      window.location.hash = '#faq';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(container.querySelector('#faq section')?.hasAttribute('hidden')).toBe(false);
  });

  it('mirrors tab arrow keys on right-to-left pages', async () => {
    await act(async () => root.render(createElement('div', { dir: 'rtl' }, createElement(RichMarkdown, { content: tabs() }))));
    const [first, second] = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    first?.focus();
    await act(async () => first?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
    expect(second?.getAttribute('aria-selected')).toBe('true');
  });
});
