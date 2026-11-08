import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TranscriptAnswer } from './transcript';

describe('saved chat citations', () => {
  it('renders numbered links to the original Arabic section and version, without model links', () => {
    const html = renderToStaticMarkup(
      <TranscriptAnswer
        answer="**ابدأ هنا** [S2] [click](https://evil.example)"
        citations={[{ id: 'S2', title: 'الإعداد', path: 'setup', heading: 'المستخدم', anchor: 'المستخدم' }]}
        projectId="docs"
        language="ar"
        version="v2"
      />,
    );
    expect(html).not.toContain('[S2]');
    expect(html).toContain('>1</a>');
    expect(html).toContain('/v2/setup?lang=ar#');
    expect(html).toContain(encodeURIComponent('المستخدم'));
    expect(html).not.toContain('evil.example');
  });
});
