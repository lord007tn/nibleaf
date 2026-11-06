import { describe, expect, it } from 'vitest';
import { parseFrontmatter, serializeGitPage } from './content';

describe('frontmatter round trip', () => {
  it('reads back exactly the title, description and icon it wrote', () => {
    const page = {
      title: 'Use "quotes", a \\ backslash: and colons',
      description: 'It\'s "fine" \\o/ — مرحبا',
      icon: 'book-open',
      content: '# Body\n',
    };
    const { meta, body } = parseFrontmatter(serializeGitPage(page));
    expect(meta).toMatchObject({ title: page.title, description: page.description, icon: page.icon });
    expect(body.trim()).toBe('# Body');
  });

  it('keeps reading frontmatter written by hand or by other tools', () => {
    const { meta } = parseFrontmatter(
      ['---', 'title: Plain title', "description: 'It''s single-quoted'", 'icon: "C:\\docs\\x"', 'sidebarTitle: "Not \\q JSON"', '---', 'Body'].join(
        '\n',
      ),
    );
    expect(meta).toEqual({ title: 'Plain title', description: "It's single-quoted", icon: 'C:\\docs\\x', sidebartitle: 'Not \\q JSON' });
  });
});
