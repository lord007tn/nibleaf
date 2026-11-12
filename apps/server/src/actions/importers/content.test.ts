import { describe, expect, it } from 'vitest';
import { deriveTitle, parseFrontmatter, serializeGitPage } from './content';

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

  it('keeps a body that starts with an indented code block intact', () => {
    const content = '\n\n    npm install nibleaf\n\nThen run it.';
    const { body } = parseFrontmatter(serializeGitPage({ title: 'Install', description: null, icon: null, content }));
    expect(body).toBe('\n    npm install nibleaf\n\nThen run it.');
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

describe('deriveTitle', () => {
  it.each([
    ['an empty title', { title: '' }, 'Body.', 'untitled-2', ''],
    ['no title under an untitled-N file name', {}, 'Body.', 'untitled-3', ''],
    ['no title, but an H1', {}, '# Install\n\nBody.', 'untitled-3', 'Install'],
    ['an empty title, but an H1', { title: '' }, '# Install', 'untitled', 'Install'],
    ['no title under an ordinary file name', {}, 'Body.', 'getting-started', 'Getting Started'],
    ['a real title', { title: 'Setup' }, 'Body.', 'untitled', 'Setup'],
  ])('%s', (_case, meta: Record<string, string>, body, name, title) => {
    expect(deriveTitle(meta, body, name)).toBe(title);
  });
});
