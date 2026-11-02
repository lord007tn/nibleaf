import { Input } from '@nibleaf/design-system/components/ui/input';
import { Slider } from '@nibleaf/design-system/components/ui/slider';
import { Textarea } from '@nibleaf/design-system/components/ui/textarea';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Field, SaveBar } from './shared';

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
  it('keeps invalid configuration disabled even when its explicit values differ from the saved defaults', () => {
    const markup = renderToStaticMarkup(<SaveBar values={{ title: 'Changed' }} defaults={{ title: 'Saved' }} invalid isSubmitting={false} />);
    expect(markup).toMatch(/<button[^>]* disabled=""/);
  });

  it('allows a reversion to an earlier title after another title was saved', () => {
    const markup = renderToStaticMarkup(<SaveBar values={{ title: 'A' }} defaults={{ title: 'B' }} isSubmitting={false} />);
    expect(markup).not.toMatch(/<button[^>]* disabled=""/);
  });
});
