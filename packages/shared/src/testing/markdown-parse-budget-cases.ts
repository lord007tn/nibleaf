/** Inputs for the Markdown parse budget: ordinary pages (from review of #905) that must parse as on main. */
const times = (count: number, line: (index: number) => string) => Array.from({ length: count }, (_, index) => line(index)).join('\n');
const fence = (language: string, body: string) => `\`\`\`${language}\n${body}\n\`\`\``;
/** About 16,500 characters of Arabic prose in one paragraph (27 KB of UTF-8). */
const arabicSentence = 'يعرض القارئ هذه الفقرة الطويلة كما كتبها المؤلف، بفواصلها ونقاطها وأقواسها (مثل هذه) دون أي تغيير. ';
export const arabicParagraph = arabicSentence.repeat(Math.ceil(16_500 / arabicSentence.length));
const englishSentence =
  'The reader shows this long paragraph as written, with its commas, full stops and the odd aside (like this one), and a well-known hyphen. ';

/** Ordinary pages that render normally on main: they must stay within the budget. */
export const ORDINARY_PAGES: Array<[string, string]> = [
  [
    '65 Promise<User> in fenced TypeScript',
    fence(
      'ts',
      times(
        65,
        (index) =>
          `export async function loadUser${index}(id: string, signal?: AbortSignal): Promise<User> { return fetchUser(id, { signal, attempt: ${index} }); }`,
      ),
    ),
  ],
  ['65 inline-code Array<string> items', times(65, (index) => `- \`Array<string>\` item ${index}`)],
  [
    '65 Java List<String> lines',
    fence(
      'java',
      times(65, (index) => `List<String> names${index} = new ArrayList<>();`),
    ),
  ],
  [
    '65 Rust Vec<u8> lines',
    fence(
      'rust',
      times(65, (index) => `let buffer${index}: Vec<u8> = Vec::new();`),
    ),
  ],
  [
    '65 #include <stdio.h> lines',
    fence(
      'c',
      times(65, () => '#include <stdio.h>'),
    ),
  ],
  ['a <ul> with 65 unclosed <li>', `<ul>\n${times(65, (index) => `<li>Item ${index}`)}\n</ul>`],
  ['65 unclosed <p>', times(65, (index) => `<p>Paragraph ${index}`)],
  [
    'a table separator padded to column width',
    [
      `| ${times(30, (index) => `Column ${index}`.padEnd(40)).replaceAll('\n', ' | ')} |`,
      `|${times(30, () => '-'.repeat(42)).replaceAll('\n', '|')}|`,
      `| ${times(30, (index) => `${index}`.padEnd(40)).replaceAll('\n', ' | ')} |`,
    ].join('\n'),
  ],
  [
    'an inline <svg> with a long path',
    `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><path d="M0 0${' l-1.5-2.25 2.5-1.75'.repeat(400)} z" fill="currentColor"/></svg>`,
  ],
  [
    'minified one-line JSON in a fenced block',
    fence(
      'json',
      JSON.stringify(
        Array.from({ length: 160 }, (_, index) => ({ id: index, name: `item-${index}`, tags: ['a', 'b'], meta: { ok: true, n: [1, 2] } })),
      ),
    ),
  ],
  ['one long Arabic paragraph', arabicParagraph],
  ['a 64k-character Arabic line', arabicSentence.repeat(Math.ceil(65_536 / arabicSentence.length))],
  ['a 64k-character English line', englishSentence.repeat(Math.ceil(65_536 / englishSentence.length))],
];
