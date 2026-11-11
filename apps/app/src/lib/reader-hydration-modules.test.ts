import { describe, expect, it } from 'vitest';
import { needsRichMarkdown } from './reader-hydration-modules';

describe('needsRichMarkdown', () => {
  it.each([
    ['HTML in a fenced example', 'Embed it:\n\n```html\n<div class="card">Hi</div>\n```'],
    ['shell variables in a fence', '```bash\n$ export PATH=$HOME/bin:$PATH\n```'],
    ['a fence inside a list item', '1. Run:\n   ```sh\n   echo $HOME and $USER\n   ```'],
    ['a tilde fence', '~~~\n<Card>\n~~~'],
    ['inline code', 'Use `<Card>` or `$HOME`, and `$PATH` too.'],
  ])('keeps the lightweight renderer for %s', (_, content) => {
    expect(needsRichMarkdown(content)).toBe(false);
  });

  it.each([
    ['HTML next to code', '```js\nlet a\n```\n\n<Note>Real component</Note>'],
    ['math next to inline code', 'Use `x`, where $x^2$ is the area.'],
    ['an escaped backtick before HTML', 'A \\`<b>bold</b>\\` word.'],
    ['an unclosed span on another line', 'A ` tick\n\n<Note>Real</Note> and ` tick'],
  ])('still uses the rich renderer for %s', (_, content) => {
    expect(needsRichMarkdown(content)).toBe(true);
  });
});
