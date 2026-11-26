import { FieldError } from '@nibleaf/design-system/components/ui/form-field';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Slider } from '@nibleaf/design-system/components/ui/slider';
import { Textarea } from '@nibleaf/design-system/components/ui/textarea';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Field, SaveBar, SectionHeader, SectionScopeProvider } from './shared';

describe('Field', () => {
  it('associates its visible label with a direct input control', () => {
    const markup = renderToStaticMarkup(
      <Field hint="Where readers land" label="Destination">
        <Input defaultValue="https://example.com" />
      </Field>,
    );

    const htmlFor = markup.match(/<label[^>]*for="([^"]+)"/)?.[1];
    expect(htmlFor).toBeTruthy();
    expect(markup).toMatch(new RegExp(`<input[^>]*id="${htmlFor}"`));
  });

  it('associates its visible label with a direct textarea control', () => {
    const markup = renderToStaticMarkup(
      <Field label="Description">
        <Textarea defaultValue="A useful description" />
      </Field>,
    );

    const htmlFor = markup.match(/<label[^>]*for="([^"]+)"/)?.[1];
    expect(htmlFor).toBeTruthy();
    expect(markup).toMatch(new RegExp(`<textarea[^>]*id="${htmlFor}"`));
  });

  it('associates its visible label with a direct slider control', () => {
    const markup = renderToStaticMarkup(
      <Field label="Reading size">
        <Slider defaultValue={16} max={20} min={12} />
      </Field>,
    );

    const htmlFor = markup.match(/<label[^>]*for="([^"]+)"/)?.[1];
    expect(htmlFor).toBeTruthy();
    expect(markup).toMatch(new RegExp(`<input[^>]*type="range"[^>]*id="${htmlFor}"`));
  });
});

describe('SaveBar', () => {
  it('announces saving and prevents duplicate submissions while the form saves', () => {
    const markup = renderToStaticMarkup(<SaveBar disabled={false} isSubmitting />);
    expect(markup).toMatch(/<button[^>]*aria-busy="true"/);
    expect(markup).toMatch(/<button[^>]*disabled=""/);
    expect(markup).toContain('data-loading=""');
  });

  it('keeps invalid configuration disabled even when its explicit values differ from the saved defaults', () => {
    const markup = renderToStaticMarkup(<SaveBar values={{ title: 'Changed' }} defaults={{ title: 'Saved' }} invalid isSubmitting={false} />);
    expect(markup).toMatch(/<button[^>]* disabled=""/);
  });

  it('allows a reversion to an earlier title after another title was saved', () => {
    const markup = renderToStaticMarkup(<SaveBar values={{ title: 'A' }} defaults={{ title: 'B' }} isSubmitting={false} />);
    expect(markup).not.toMatch(/<button[^>]* disabled=""/);
  });
});

it('keeps shared field errors quiet unless the caller requests a live region', () => {
  const errors = ['Required'];
  expect(renderToStaticMarkup(<FieldError errors={errors} id="name-error" />)).not.toContain('role=');
  expect(renderToStaticMarkup(<FieldError errors={errors} role="status" />)).toContain('role="status"');
});

describe('SectionHeader', () => {
  it('is a page section (h2) on its own, and an h3 under a group heading', () => {
    const alone = renderToStaticMarkup(<SectionHeader description="Logo and colours." icon={null} title="Branding" />);
    expect(alone).toContain('<h2 class="font-semibold text-lg tracking-tight">Branding</h2>');
    const nested = renderToStaticMarkup(
      <SectionScopeProvider value={{ headingLevel: 3, chrome: 'plain' }}>
        <SectionHeader description="Logo and colours." icon={null} title="Branding" />
      </SectionScopeProvider>,
    );
    expect(nested).toContain('<h3 class="font-semibold text-sm">Branding</h3>');
    expect(nested).not.toContain('<h2');
    expect(nested).toContain('Logo and colours.');
  });
});
