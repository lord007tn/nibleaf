/** @vitest-environment jsdom */
/** The footer's small print: "Privacy choices" joins it only when there is one. */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MadeWithBadge } from './made-with-badge';

const separators = (html: string) => (html.match(/<span aria-hidden="true">·<\/span>/g) ?? []).length;

describe('MadeWithBadge', () => {
  it('has one separator, between the attribution and "Report abuse", when nothing else joins it', () => {
    const html = renderToStaticMarkup(<MadeWithBadge lang="en" />);
    expect(separators(html)).toBe(1);
    expect(html.trimEnd().endsWith('</a></div>')).toBe(true);
  });

  it('adds a separator and the extra small print when given one', () => {
    const html = renderToStaticMarkup(
      <MadeWithBadge lang="en">
        <button type="button">Privacy choices</button>
      </MadeWithBadge>,
    );
    expect(separators(html)).toBe(2);
    expect(html).toContain('Privacy choices');
  });

  it('treats an absent child (a site without consent) as nothing', () => {
    expect(separators(renderToStaticMarkup(<MadeWithBadge lang="en">{null}</MadeWithBadge>))).toBe(1);
  });
});
