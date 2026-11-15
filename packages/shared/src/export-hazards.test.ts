import MarkdownIt from 'markdown-it';
import { type DefaultTreeAdapterTypes, Parser, parseFragment, serialize } from 'parse5';
import { expect, it } from 'vitest';
import visibleRepros from './__fixtures__/markdown-export.visible-repros.json';
import { AttributeReplay } from './export-html-replay';
import { type ExportHtmlMetrics, readExportHtml } from './export-html-source';
import { srcsetCandidates } from './export-url-policy';
import { checkHazardMatrix, exportFanoutSource, exportTargets } from './testing/export-664-guard';
import { readerSanitizedActiveHtml } from './testing/export-guard';
import { inspectExport } from './testing/export-oracle';

const attacks = [
  '<img onerror=run()>',
  '<svg/onload=run()>',
  '<a href="jav&#x61;script:run()">X</a>',
  '<svg><a xlink:href="java&#x09;script:run()">X</a></svg>',
  '<img srcset="/safe.png 1x, data:image/png;base64,AAAA 2x">',
  '<a ping="/safe javascript:run()">X</a>',
  '<link imagesrcset="/safe 1x, vbscript:run() 2x">',
  '<applet archive="/safe.jar,javascript:run()"></applet>',
  '> <div>\n> ~~~\n- > <a href="java\n  > script:alert(1)">click</a>',
  '`<i title="`\n\n<img onerror\f=alert(1)>',
  '<div title="\n\n[X](onerror=ATTACK)',
  '<div title="\n\n[X](href=javascript:ATTACK)',
  "<div title='\n\n[X](/safe \"' onerror=ATTACK '\")",
];

it('fails on main for live handlers and URLs, then emits none in either export', () => {
  const activeMain = attacks.flatMap((source) => exportTargets.map((target) => inspectExport(target.baseline(source)).active));
  expect(activeMain.filter(Boolean)).toHaveLength(13);
  const report = checkHazardMatrix(attacks);
  expect(report.failures).toEqual([]);
  expect(report.totals.active).toBe(0);
  for (const source of attacks) for (const { project } of exportTargets) expect(readerSanitizedActiveHtml(project(source))).toBe(0);
});

it('preserves all 28 historical visible-text repros through the combined pipeline', () => {
  expect(checkHazardMatrix(visibleRepros).failures).toEqual([]);
});

it('keeps rejected Markdown destinations, references, autolinks and inert HTML byte-identical', () => {
  const sources = [
    '[X](javascript:run())',
    '![X](vbscript:run())',
    '[ref]: javascript:run()\n\n[X][ref]',
    '[unused]: data:text/html,x',
    '<javascript:run()>',
    '<template><img onerror=HIDDEN()></template>',
    '<!-- <img onerror=HIDDEN()> -->',
    '`<img onerror=CODE()>`',
    '~~~\n<img onerror=CODE()>\n~~~',
  ];
  for (const source of sources)
    for (const { project, baseline } of exportTargets) {
      expect(inspectExport(baseline(source)).active).toBe(0);
      expect(project(source)).toBe(baseline(source));
    }
});

const crRepros = [
  'BEFORE `INLINE`\r\r  <object>BODY</object>\r  <?pi KEPT\r</textarea>\r    CODE\r<img onerror=OWN()>\r\rAFTER *TEXT*',
  '  <embed data-x="a>b">BODY\r  <?pi KEPT\r</textarea>\r    CODE\r<img onerror=OWN()>',
];
it.each(['\n', '\r\n', '\r'])('preserves outside paragraphs and code at %j owned boundaries', (ending) => {
  const report = checkHazardMatrix(crRepros.map((source) => source.replaceAll('\r', ending)));
  expect(report.failures).toEqual([]);
  expect(report.totals.outsideStructure).toBe(0);
});

it.each([
  ['/safe 1x, data:x 2x', ['/safe', 'data:x']],
  ['https://safe.test/a,b.png 1x, javascript:x 2x', ['https://safe.test/a,b.png', 'javascript:x']],
  ['/safe future(x,y), data:x invalid', ['/safe', 'data:x']],
  ['data:image/png;base64,AAAA 1x, /safe 2x', ['data:image/png;base64,AAAA', '/safe']],
  ['/safe, /next,', ['/safe', '/next']],
  ['/safe future(unclosed, data:x', ['/safe']],
] as const)('splits compound URL candidates: %s', (value, expected) => expect(srcsetCandidates(value)).toEqual(expected));

it('replays cached values exactly in raw, foreign, quoted, comment and declaration contexts', () => {
  const markdown = new MarkdownIt({ html: true });
  const prefixes = [
    '',
    '<div title="',
    "<div title='",
    '<div on',
    '<!--',
    '<!-- --',
    '<textarea>',
    '<xmp>',
    '<script>',
    '<svg>',
    '<svg><![CDATA[',
    '<svg><title>',
    '<math><mtext>',
    '<!doctype html public "',
    "<!doctype html public '",
  ];
  const values = [
    'abc',
    'onerror=run()',
    "a' onerror=run() '",
    'java\tscript:run()',
    '&quot; onerror=run()',
    'a & b',
    '--',
    'a\nb',
    'a(b),c',
    'javascript:run()',
    '\ud800',
    '\udc00',
    '',
    'a\rb',
    "' href='javascript:x' onload='run()",
  ];
  const cache = new AttributeReplay();
  for (let repeat = 0; repeat < 2; repeat++)
    for (const prefix of prefixes)
      for (const value of values) {
        const escaped = markdown.utils.escapeHtml(value),
          before = `${prefix}<p><a href="`,
          after = '" title="hello">x</a></p><img onerror=Y>';
        const parser = Parser.getFragmentParser<DefaultTreeAdapterTypes.DefaultTreeAdapterMap>(null, {});
        parser.tokenizer.write(before, false);
        cache.apply(parser.tokenizer, escaped);
        parser.tokenizer.write(after, true);
        expect(serialize(parser.getFragment()), JSON.stringify({ prefix, value })).toBe(serialize(parseFragment(before + escaped + after)));
      }
  expect(cache.analyses).toBeLessThan(prefixes.length * values.length);
});

it.each(['<div title="', "<div title='"])('bounds throwaway buffers and analyses while keeping malformed fanout inert: %s', (prefix) => {
  for (const n of [128, 512]) {
    const source = exportFanoutSource(n, prefix);
    for (const { project, baseline } of exportTargets) {
      const before = baseline(source),
        metrics: ExportHtmlMetrics = { generatedBytes: 0, replayBytes: 0, replayAnalyses: 0 };
      expect(readExportHtml(before, { hazards: true, metrics })).toBeUndefined();
      expect(metrics.generatedBytes + metrics.replayBytes).toBeLessThan(source.length * 8);
      expect(metrics.replayAnalyses).toBeLessThanOrEqual(6);
      expect(inspectExport(before).active).toBe(0);
      expect(project(source)).toBe(before);
    }
  }
});
