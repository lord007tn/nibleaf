import { expect, it } from 'vitest';
import { markdownReferences, remoteImageSources, replaceImportReferences } from './import-references';

const references = (source: string) => markdownReferences(source).map(({ value, image }) => ({ value, image }));

it('reads an image inside a link label before the link itself', () => {
  expect(references('[![Badge](b.png)](https://x.io)')).toEqual([
    { value: 'b.png', image: true },
    { value: 'https://x.io', image: false },
  ]);
  expect(references('[![a](b.png) ![c](d.png)](e.md)')).toEqual([
    { value: 'b.png', image: true },
    { value: 'd.png', image: true },
    { value: 'e.md', image: false },
  ]);
  expect(remoteImageSources('[![Badge](https://x.io/b.png)](https://x.io)')).toEqual(['https://x.io/b.png']);
});

it('ignores references inside an image description', () => {
  expect(references('![a [b](c.md)](x.png)')).toEqual([{ value: 'x.png', image: true }]);
  expect(references('![outer ![inner](b.png)](a.png)')).toEqual([{ value: 'a.png', image: true }]);
  expect(references('![[[a](b.md)](c.md)](d.png)')).toEqual([{ value: 'd.png', image: true }]);
  expect(references('![a [b](c.md)]()')).toEqual([]);
  expect(references('![a ![b](inner.png)]( )')).toEqual([]);
  expect(references('![a [b](c.md)](x.png (title))')).toEqual([{ value: 'x.png', image: true }]);
  expect(references('![a [b](c.md)]( x.png )')).toEqual([{ value: 'x.png', image: true }]);
  expect(references('[![a [b](c.md)](x.png)](y.md)')).toEqual([
    { value: 'x.png', image: true },
    { value: 'y.md', image: false },
  ]);
  expect(references('![a](b.png) [c](d.md) ![e](f.png)')).toHaveLength(3);
});

it('keeps a link inside brackets that never became an image', () => {
  expect(references('![a [b](c.md)] d')).toEqual([{ value: 'c.md', image: false }]);
  expect(references('![a [b](c.md)](d')).toEqual([{ value: 'c.md', image: false }]);
  expect(references('![a [b](c.md)](bad destination)')).toEqual([{ value: 'c.md', image: false }]);
  expect(references('![a [b](c.md)](<bad)')).toEqual([{ value: 'c.md', image: false }]);
  expect(references('![a ![b](c.png)](bad destination)')).toEqual([{ value: 'c.png', image: true }]);
});

it('treats an escaped image marker as text', () => {
  expect(references(String.raw`\![a](b.md)`)).toEqual([{ value: 'b.md', image: false }]);
  expect(references(String.raw`\\![a](b.png)`)).toEqual([{ value: 'b.png', image: true }]);
  expect(references(String.raw`\\\![a](b.md)`)).toEqual([{ value: 'b.md', image: false }]);
  expect(references(String.raw`\![a [b](c.md)](x.png)`)).toEqual([
    { value: 'c.md', image: false },
    { value: 'x.png', image: false },
  ]);
});

it('rewrites nested references without moving the text around them', () => {
  const source = 'a [![Badge](b.png "t")](<c d.md>) e';
  expect(replaceImportReferences(source, markdownReferences(source), ({ value }) => value.toUpperCase())).toBe('a [![Badge](B.PNG "t")](<C D.MD>) e');
});

it('reads surrounding space and every title style', () => {
  expect(references('[a]( b.md ) [c](d.md (t)) [e](<f g.md> "t") [h](i.md \'t\')').map(({ value }) => value)).toEqual([
    'b.md',
    'd.md',
    'f g.md',
    'i.md',
  ]);
  expect(references('[a](b.md "t\') [c](d.md ") [e](f.md g)')).toEqual([]);
});

it('treats everything inside a destination as that destination', () => {
  expect(references('[a](b[c](d)e) [f](g)')).toEqual([
    { value: 'b[c](d)e', image: false },
    { value: 'g', image: false },
  ]);
});

it('reads crossed pairs once, without overlapping references', () => {
  const depth = 4;
  const found = markdownReferences(`${'['.repeat(depth)}${']('.repeat(depth)}x${')'.repeat(depth)}`);
  expect(found).toHaveLength(1);
});

it('ends an angle destination at its own parenthesis', () => {
  expect(references('[a](<b) and [c](d>) [e](<f g>)')).toEqual([
    { value: 'd>', image: false },
    { value: 'f g', image: false },
  ]);
});
