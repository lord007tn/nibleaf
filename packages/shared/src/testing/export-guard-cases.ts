/** Exact 2,640-shape matrix from the independent 6d919df8 review. */
export const htmlExportBoundaryCases = () => {
  const wrappers = [
    ['style', '<style>', '</style>'],
    ['script', '<script>', '</script>'],
    ['pre', '<pre>', '</pre>'],
    ['textarea', '<textarea>', '</textarea>'],
    ['comment', '<!--', '-->'],
    ['pi', '<?review', '?>'],
    ['decl', '<!DOCTYPE', '>'],
    ['cdata', '<![CDATA[', ']]>'],
    ['div', '<div>', '</div>'],
    ['span', '<span>', '</span>'],
    ['custom', '<custom-tag>', '</custom-tag>'],
  ] as const;
  const containers: ReadonlyArray<(lines: string[]) => string[]> = [
    (lines) => lines,
    (lines) => lines.map((line) => `> ${line}`),
    (lines) => lines.map((line, at) => `${at ? '  ' : '- '}${line}`),
    (lines) => lines.map((line, at) => `${at ? '  > ' : '- > '}${line}`),
    (lines) => ['<CodeGroup>', ...lines.map((line) => `    ${line}`), '</CodeGroup>'],
    (lines) => ['<Note>', ...lines, '</Note>'],
  ];
  const cases: Array<{ index: number; source: string; markers: string[] }> = [];
  for (const [, open, close] of wrappers)
    for (const closed of [false, true])
      for (const wrap of containers)
        for (const fence of ['~~~', '```md'])
          for (const fenceClosed of [false, true])
            for (let gap = 0; gap < 5; gap++) {
              const index = cases.length;
              const markers = ['EXPR', 'NOTE', 'TEXT', 'INLINE', 'IMPORT', 'EXPORT', 'MEDIA', 'FOLLOW'].map((name) => `R${index}_${name}_Z`);
              const body = [
                `{${markers[0]}}`,
                `<Note>${markers[1]}</Note>`,
                markers[2] as string,
                `\`{${markers[3]}}\``,
                `import ${markers[4]} from "pkg"`,
                `export const ${markers[5]} = 1;`,
                `![${markers[6]}](/image.png)`,
              ];
              if (gap === 1) body.splice(1, 0, '');
              if (gap === 2) body.splice(3, 0, '');
              if (gap === 3) body.unshift('');
              if (gap === 4) body.push(close, '');
              const source = [
                ...wrap([open, fence, ...body, ...(fenceClosed ? [(fence[0] as string).repeat(3)] : []), ...(closed ? [close] : [])]),
                '',
                markers[7],
              ].join('\n');
              cases.push({ index, source, markers });
            }
  return cases;
};

export const EXPORT_GUARD_SEED = 0xc6_11_ba_be;

/** Vendored from the independent round-4 generator (seed 0xc611babe).
 * Embedded newlines intentionally retain the reviewer's partial prefixes. */
export const seededExportCases = () => {
  let state = EXPORT_GUARD_SEED;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  const pick = <const T extends readonly [unknown, ...unknown[]]>(values: T): T[number] => values[next() % values.length];
  const cases: Array<{ index: number; source: string; markers: string[] }> = [];
  for (let index = 0; index < 4096; index++) {
    const markers = Array.from({ length: 12 }, (_, marker) => `ZX${index}P${marker}QZ`);
    const html = pick([
      ['<div data-x="x">', '</div>'],
      ['<article>', '</article>'],
      ['<!--', '-->'],
      ['<?x', '?>'],
      ['<![CDATA[', ']]>'],
      ['<textarea>', '</textarea>'],
      ['<pre>', '</pre>'],
      ['<span>', '</span>'],
      ['<x-widget>', '</x-widget>'],
    ] as const);
    const marker = pick(['~', '`'] as const);
    const length = 3 + (next() % 5);
    const opener = marker.repeat(length) + pick(['', ' md', ' عربي'] as const);
    const closer = pick([
      marker.repeat(length),
      marker.repeat(length + 2),
      marker.repeat(Math.max(1, length - 1)),
      (marker === '~' ? '`' : '~').repeat(length),
      '',
    ] as const);
    const inline = pick([
      [`\`${markers[4]}`, `{${markers[5]}}\``],
      [`\`\`${markers[4]}`, `<Note>${markers[5]}</Note>\`\``],
      [markers[4] as string, markers[5] as string],
    ] as const);
    const payload = [
      `{${markers[1]}}`,
      `<Note>${markers[2]} عربي</Note>`,
      `${markers[3]} حروف عربية`,
      ...inline,
      `import ${markers[6]} from "pkg"`,
      `export const ${markers[7]} = "نص";`,
      `![${markers[8]}](/image.png)`,
      `<Video src="https://example.test/${markers[9]}.mp4" />`,
    ];
    payload.splice(next() % (payload.length + 1), 0, pick(['', html[1], `${html[1]}\n`, `\n${html[1]}`, '<div>\n'] as const));
    let body = [html[0], opener, ...payload, ...(closer ? [closer] : []), ...(next() % 2 ? [html[1]] : [])];
    const kind = next() % 7;
    const first = ['', '> ', '- ', '1. > ', '> - > ', '> 1. > ', '> - > '][kind] as string;
    const continuation = ['', '> ', '  ', '   > ', '>   > ', '>    > ', '>   > '][kind] as string;
    const exit = pick([-1, -1, 2, 4, body.length - 1] as const);
    body = body.map((line, at) => (at === 0 ? first : at >= exit && exit >= 0 ? pick(['', continuation, '> '] as const) : continuation) + line);
    if (next() % 2) body = ['<Note>', ...body, '</Note>'];
    if (next() % 4 === 0) body = ['<CodeGroup>', ...body.map((line) => `    ${line}`), '</CodeGroup>'];
    const source = [
      `${markers[0]} بداية`,
      '',
      ...body,
      '',
      `{${markers[10]}}`,
      `${markers[11]} نهاية`,
      ...pick([[], ['<script data-probe="yes">SAFE</script>'], ['~~~', '<iframe src="https://example.test" />']] as const),
    ].join('\n');
    cases.push({ index, source, markers });
  }
  return cases;
};

/** The 13 portable outputs that round 4 newly activated relative to main. */
export const PORTABLE_REGRESSION_IDS = [63, 597, 752, 824, 838, 874, 907, 1436, 1806, 2101, 3348, 3437, 3985] as const;

/** #633: a fence-looking line inside HTML must not exempt a later tag from export safety. */
export const activeHtmlExportCases = () => {
  const payloads = [
    '<script>SAFE</script>',
    '<style>SAFE</style>',
    '<iframe src="https://example.test">SAFE</iframe>',
    '<object data="https://example.test">SAFE</object>',
    '<embed src="https://example.test/SAFE">',
    '<img src="/SAFE" onerror="run()">',
    '<div onclick="run()">SAFE</div>',
    '<a href="javascript:run()">SAFE</a>',
    '<a href="data:text/html,SAFE">SAFE</a>',
    '<img src="javascript:SAFE">',
    '<img src="data:text/html,SAFE">',
    '<a href="java&#x09;script&#58;run()">SAFE</a>',
    '<script><img src="/SAFE" onerror="run()"></script>',
    '<style><iframe src="https://example.test/SAFE"></iframe></style>',
    '<textarea><img src="/SAFE" onerror="run()"></textarea>',
    '<div title="a > b" onclick="run()">SAFE</div>',
  ];
  const containers = [
    { name: 'top level', wrap: (payload: string) => payload },
    { name: 'quote exit (#633)', wrap: (payload: string) => `> <div>\n> ~~~\n${payload}` },
    { name: 'nested quote exit', wrap: (payload: string) => `> > <div>\n> > ~~~\n${payload}` },
    { name: 'quote in list exit', wrap: (payload: string) => `- > <div>\n  > ~~~\n${payload}` },
    { name: 'list in quote exit', wrap: (payload: string) => `> - <div>\n>   ~~~\n${payload}` },
    { name: 'quoted HTML', wrap: (payload: string) => `> <div>\n> ~~~\n> ${payload}\n> </div>` },
    { name: 'list HTML', wrap: (payload: string) => `- <div>\n  ~~~\n  ${payload}\n  </div>` },
    { name: 'component quote exit', wrap: (payload: string) => `<Note>\n> <div>\n> ~~~\n${payload}\n</Note>` },
    { name: 'nested components', wrap: (payload: string) => `<Tabs>\n<Tab title="Example">\n> <div>\n> ~~~\n${payload}\n</Tab>\n</Tabs>` },
  ];
  return containers.map(({ name, wrap }) => ({ name, sources: payloads.map(wrap) }));
};
