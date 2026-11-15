export const reviewedExportCases = (): string[] => {
  const tags = ['script', 'style', 'iframe', 'object', 'embed'];
  const wrappers = [
    (s: string) => s,
    (s: string) =>
      s
        .split('\n')
        .map((x) => `> ${x}`)
        .join('\n'),
    (s: string) =>
      s
        .split('\n')
        .map((x) => `> > ${x}`)
        .join('\n'),
    (s: string) =>
      `${s
        .split('\n')
        .map((x, i) => (i ? '  ' : '- ') + x)
        .join('\n')}\n- NEXT`,
    (s: string) =>
      `${s
        .split('\n')
        .map((x, i) => (i ? '    ' : '12. ') + x)
        .join('\n')}\n13. NEXT`,
    (s: string) =>
      `${s
        .split('\n')
        .map((x, i) => (i ? '  > ' : '- > ') + x)
        .join('\n')}\n- NEXT`,
    (s: string) =>
      `${s
        .split('\n')
        .map((x, i) => (i ? '>   > ' : '> - > ') + x)
        .join('\n')}\n> - NEXT`,
    (s: string) => `<Note>\n\n${s}\n\n</Note>`,
  ];
  const sources = new Set(['> <script></script>\n> <a>\n\tCODE', '- <pre><script></script>\n\n  TEXT\n- NEXT']);
  for (const tag of tags)
    for (const opener of ['', '<pre>', '<textarea>', '<div>', '<table>\n<tr><td>', '<svg>', '<math>'])
      for (const close of ['', `</${tag}>`, '</textarea>', '</pre>', '</script>', '</style>', '</div>'])
        for (const tail of [
          '\n    CODE',
          '\n~~~js\nCODE\n~~~',
          '\n<a>\n\tCODE',
          '\n\nText *kept* with `CODE`.',
          '\n<img src=x onerror="INERT()"><a href="java&#115;cript:INERT()">LINK</a>',
          '\n\n<img src="data:text/html,INERT" onerror="INERT()">',
        ])
          for (const wrap of wrappers) {
            sources.add(wrap(`${opener}<${tag}>BODY\n${close}${tail}`));
          }
  // Seeded compositions exercise multiple runs, mixed tabs, non-uniform containers,
  // closing-tag injections, unterminated attributes and inert raw-text bodies.
  let seed = 0x6_52_a1_0b;
  const random = (n: number) => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) % n;
  };
  const pieces = [
    '<script>',
    '</script>',
    '<style>',
    '</style>',
    '<iframe>',
    '</iframe>',
    '<object>',
    '</object>',
    '<embed>',
    '<pre>',
    '</pre>',
    '</textarea>',
    '<a>',
    '<div>',
    '</div>',
    '<img onerror="ATTACK()">',
    '<a href="javascript:ATTACK()">LINK</a>',
    '~~~',
    '~~~js',
    '    CODE',
    '\tCODE',
    'TEXT *kept* `CODE`',
    '',
    '',
    '<script data-x="unterminated',
    '<SCRIPT>',
    '<!--',
    '-->',
  ];
  for (let i = 0; i < 6000; i++) {
    const lines: string[] = [];
    for (let j = 0, n = 3 + random(9); j < n; j++)
      lines.push((['', '', '> ', '  ', '\t', '- ', '  > '][random(7)] ?? '') + (pieces[random(pieces.length)] ?? ''));
    sources.add(lines.join('\n'));
  }

  return [...sources];
};
