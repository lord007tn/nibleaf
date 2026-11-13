import { expect, it } from 'vitest';
import { convertGhostHtml } from './ghost-mapping';

it('keeps plain HTML video embeds and dividers from Ghost exports', () => {
  const result = convertGhostHtml('<p>Tour</p><iframe src="https://youtu.be/abcdefghijk" title="Tour"></iframe><hr><p>Next</p>');
  expect(result.markdown).toContain('<iframe src="https://www.youtube-nocookie.com/embed/abcdefghijk" title="Tour"></iframe>');
  expect(result.markdown).toContain('\n\n---\n\n');
});
