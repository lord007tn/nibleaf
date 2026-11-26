/** Inputs for the Markdown parse budget: ordinary pages (from review of #905) that must parse as on main. */
const times = (count: number, line: (index: number) => string) => Array.from({ length: count }, (_, index) => line(index)).join('\n');
const fence = (language: string, body: string) => `\`\`\`${language}\n${body}\n\`\`\``;
/** About 16,500 characters of Arabic prose in one paragraph (27 KB of UTF-8). */
const arabicSentence = 'يعرض القارئ هذه الفقرة الطويلة كما كتبها المؤلف، بفواصلها ونقاطها وأقواسها (مثل هذه) دون أي تغيير. ';
export const arabicParagraph = arabicSentence.repeat(Math.ceil(16_500 / arabicSentence.length));
const englishSentence =
  'The reader shows this long paragraph as written, with its commas, full stops and the odd aside (like this one), and a well-known hyphen. ';

/** A table as the editor saves one with a merged cell: one line of HTML (aligned-table.ts). */
const editorTable = (rows: number) => {
  const cell = (text: string) => `<td colspan="1" rowspan="1"><p>${text}</p></td>`;
  const head = '<tr><th colspan="2" rowspan="1"><p>Plan</p></th><th colspan="1" rowspan="1"><p>Price</p></th></tr>';
  const body = times(rows, (index) => `<tr>${cell(`Row ${index}`)}${cell('Yes')}${cell(`$${index}`)}</tr>`).replaceAll('\n', '');
  return `# Pricing\n\n<table><tbody>${head}${body}</tbody></table>\n\nAfter.\n`;
};

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
  // Round two of the review: one-line HTML tables, as the editor saves a table with a merged cell and GitBook imports keep them.
  ['a one-line HTML table from the editor (36 rows)', editorTable(36)],
  ['a one-line HTML table from the editor (2,000 rows)', editorTable(2000)],
  [
    'a one-line plain HTML table (2,000 rows)',
    `<table><thead><tr><th>Name</th><th>Plan</th><th>Price</th></tr></thead><tbody>${times(2000, (index) => `<tr><td>Row ${index}</td><td>Team</td><td>${index}</td></tr>`).replaceAll('\n', '')}</tbody></table>`,
  ],
  [
    'a one-line HTML table with <code> and <strong> (2,000 rows)',
    `<table><tbody>${times(2000, (index) => `<tr><td><code>key_${index}</code></td><td><strong>Yes</strong></td><td>${index}</td></tr>`).replaceAll('\n', '')}</tbody></table>`,
  ],
  // Markers count per paragraph: list items, headings and table rows are paragraphs of their own.
  ['a 400-item link list without blank lines', times(400, (index) => `- [Page ${index}](/docs/page-${index})`)],
  ['a 400-step numbered list with links', times(400, (index) => `${index + 1}. Open [step ${index}](/steps/${index}) and press **Save**.`)],
  ['400 nested items with links and code', `- Reference\n${times(400, (index) => `    - [Item ${index}](/reference/${index}) \`item_${index}\``)}`],
  ['400 headings with links without blank lines', times(400, (index) => `## [Section ${index}](/sections/${index}) *new*`)],
  [
    'a 2,000-row Markdown table with links and code',
    `| Name | Link | Type |\n| --- | --- | --- |\n${times(2000, (index) => `| **Row ${index}** | [Open](/rows/${index}) | \`Data \\| null\` |`)}`,
  ],
  ['400 bold terms on one line', times(400, (index) => `**term ${index}**`).replaceAll('\n', ', ')],
  // Inline code holding a pipe, or wrapping onto the next line, is still code: none of these tags nest.
  ['65 paragraphs with `useRef<Button | null>` in inline code', times(65, (index) => `Call \`useRef<Button | null>(null)\` in step ${index}.\n`)],
  ['65 paragraphs with inline code wrapping across lines', times(65, (index) => `The type \`Ref<Button\n| null>\` is set in step ${index}.\n`)],
  ['inline code with `a || b`', times(65, (index) => `Use \`a || b <Button>\` in case ${index}.\n`)],
  ['a table with `\\|` in inline code', `| Type | Step |\n| --- | --- |\n${times(65, (index) => `| \`Ref<Button \\| null>\` | ${index} |`)}`],
  ['a 64k-character Arabic line', arabicSentence.repeat(Math.ceil(65_536 / arabicSentence.length))],
  ['a 64k-character English line', englishSentence.repeat(Math.ceil(65_536 / englishSentence.length))],
];
