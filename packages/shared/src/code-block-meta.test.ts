import { describe, expect, it } from 'vitest';
import { codeDiffLines, parseCodeBlockMeta, parseCodeLines, serializeCodeBlockMeta } from './code-block-meta';
import { normalizePublicMarkdownContent } from './public-markdown-content';

describe('Mintlify code metadata', () => {
  it('parses every option, bare multiword titles and ignored themes', () => {
    expect(
      parseCodeBlockMeta('ts My example icon="terminal" {1,3-5} focus={2,4-5} lines wrap expandable nocopy theme={null} custom="keep this"'),
    ).toEqual({
      language: 'ts',
      title: 'My example',
      icon: 'terminal',
      highlight: [1, 3, 4, 5],
      focus: [2, 4, 5],
      lines: true,
      wrap: true,
      expandable: true,
      nocopy: true,
      rest: ['custom="keep this"'],
    });
  });
  it('accepts quoted, braced and bare options and explicit false', () => {
    const meta = parseCodeBlockMeta("js title='File name' highlight='1-2,5' focus=2,4 lines='false' nocopy=\"false\" wrap={false}");
    expect(meta).toMatchObject({ title: 'File name', highlight: [1, 2, 5], focus: [2, 4], lines: false, nocopy: false, wrap: false });
    expect(parseCodeBlockMeta('nocopy').nocopy).toBe(true);
  });
  it('preserves unchanged spelling and rewrites only edited options', () => {
    const source = "  js  Bare title  lines='true' highlight={1-2} x-custom={keep me} theme={null}  ";
    const { rest: _, ...original } = parseCodeBlockMeta(source);
    expect(serializeCodeBlockMeta(source, original)).toBe(source);
    const changed = serializeCodeBlockMeta(source, { title: 'New file', highlight: [2, 5], wrap: true });
    expect(changed).toContain('title="New file"');
    expect(changed).toContain('highlight={2,5}');
    expect(changed).toContain("lines='true'");
    expect(changed).toContain('x-custom={keep me} theme={null}');
    expect(parseCodeBlockMeta(changed)).toMatchObject({ title: 'New file', highlight: [2, 5], wrap: true });
  });
  it('rejects invalid and unbounded line ranges', () => {
    for (const value of ['0', '5-3', '1,', 'abc', '1-10001']) expect(parseCodeLines(value)).toBeNull();
    expect(parseCodeLines(' 1, 3 - 5, 3 ')).toEqual([1, 3, 4, 5]);
  });
  it.each(['//', '#', '--', '<!--', '/*'])('strips trailing %s diff comments and applies counts', (comment) => {
    const close = comment === '<!--' ? ' -->' : comment === '/*' ? ' */' : '';
    expect(codeDiffLines(`one ${comment} [!code ++:3]${close}\ntwo\nthree\nfour`)).toEqual([
      { text: 'one', diff: 'add' },
      { text: 'two', diff: 'add' },
      { text: 'three', diff: 'add' },
      { text: 'four', diff: undefined },
    ]);
    expect(codeDiffLines(`old ${comment} [!code --]${close}`)[0]).toEqual({ text: 'old', diff: 'remove' });
  });
  it('keeps directive-like strings and authored public Markdown intact', () => {
    expect(codeDiffLines('const s = "// [!code ++]"')[0]?.text).toBe('const s = "// [!code ++]"');
    const markdown =
      '```ts title="Example" icon="terminal" highlight={1,3-5} focus={2} lines wrap expandable nocopy theme={null} custom="x"\nx // [!code ++]\n```';
    expect(normalizePublicMarkdownContent(markdown)).toBe(markdown);
  });
});

it('puts the language first when a new block receives options before its language', () => {
  expect(serializeCodeBlockMeta('', { title: 'Example', lines: true, language: 'js' })).toBe('js title="Example" lines');
  expect(serializeCodeBlockMeta('js title="Example"', { language: '' })).toBe('text title="Example"');
});
