import MarkdownIt from 'markdown-it';
import { expect, it } from 'vitest';
import { captureExportStructure, compareExportStructure } from './export-structure';

const md = new MarkdownIt({ html: true });
const compare = (source: string, output: string) =>
  compareExportStructure(captureExportStructure(source, md.parse(source, {})), output, md.parse(output, {}));

it('normalizes the maximal consecutive HTML run within its original container', () => {
  const source = '- <script></script>\n  <a>\n- NEXT';
  const model = captureExportStructure(source, md.parse(source, {}));
  expect(model.runs.map((run) => [run.start, run.end])).toEqual([[0, 2]]);
  expect(compare(source, '- &lt;script>&lt;/script>\n  <a>\n- NEXT').equal).toBe(true);
});
it('rejects absorbing code after an untouched HTML continuation', () => {
  expect(compare('> <script></script>\n> <a>\n\tCODE', '> &lt;script></script>\n> <a>\n\tCODE').equal).toBe(false);
});
it('allows one exact separator at the HTML boundary while preserving code and tightness', () => {
  expect(compare('- <script></script>\n      CODE\n- NEXT', '- &lt;script>&lt;/script>\n  ***\n      CODE\n- NEXT').equal).toBe(true);
});
it.each([
  '- &lt;script>&lt;/script>\n  ***\n  ***\n      CODE\n- NEXT',
  '- &lt;script>&lt;/script>\n\n      CODE\n- NEXT',
  '- &lt;script>&lt;/script>\n  ***\n  CODE\n- NEXT',
  '- &lt;script>&lt;/script>\n  ***\n      CODE\n- NEXT\n***',
])('rejects formatting outside the exact bound: %s', (output) => {
  expect(compare('- <script></script>\n      CODE\n- NEXT', output).equal).toBe(false);
});
it('allows whitespace padding only on original blank lines inside the run', () => {
  const source = '- <script>BODY\n  \n  </script>\n- NEXT';
  expect(compare(source, '- &lt;script>BODY\n  &#32;\n  &lt;/script>\n- NEXT').equal).toBe(true);
  expect(compare(source, '- &lt;script>BODY&#32;\n  &#32;\n  &lt;/script>\n- NEXT').equal).toBe(false);
});
it('does not confuse an inserted separator with the following authored thematic break', () => {
  const source = '- <script></script>\n  ***\n      CODE\n- NEXT';
  expect(compare(source, '- &lt;script>&lt;/script>\n  ***\n  ***\n      CODE\n- NEXT').equal).toBe(true);
});
it.each(['\n\n', '\n\n\n'])('keeps authored blank lines after an untouched HTML run: %j', (gap) => {
  const source = `<pre>KEPT</pre>${gap}TEXT\n<script>BODY</script>`;
  expect(compare(source, `<pre>KEPT</pre>${gap}TEXT\n\n&lt;script>BODY&lt;/script>`).equal).toBe(true);
});
