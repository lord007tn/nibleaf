const targets = ['script', 'style', 'iframe', 'object', 'embed'];
const wrappers = [
  (s: string) => s,
  (s: string) =>
    s
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n'),
  (s: string) =>
    s
      .split('\n')
      .map((line) => `> > ${line}`)
      .join('\n'),
  (s: string) =>
    `${s
      .split('\n')
      .map((line, i) => (i ? '  ' : '- ') + line)
      .join('\n')}\n- NEXT`,
  (s: string) =>
    `${s
      .split('\n')
      .map((line, i) => (i ? '   ' : '1. ') + line)
      .join('\n')}\n2. NEXT`,
  (s: string) =>
    `${s
      .split('\n')
      .map((line, i) => (i ? '  > ' : '- > ') + line)
      .join('\n')}\n- NEXT`,
  (s: string) =>
    `${s
      .split('\n')
      .map((line, i) => (i ? '>   > ' : '> - > ') + line)
      .join('\n')}\n> - NEXT`,
  (s: string) => `<Note>\n\n${s}\n\n</Note>`,
  (s: string) =>
    `<CodeGroup>\n\n${s
      .split('\n')
      .map((line) => `    ${line}`)
      .join('\n')}\n</CodeGroup>`,
  (s: string) => `<Tabs>\n<Tab title="T">\n\n${s}\n\n</Tab>\n</Tabs>`,
];

export const expandedExportStructureCases = (): string[] => {
  const openers = [
    ['<pre>', '</pre>'],
    ['<textarea>', '</textarea>'],
    ['<script>', '</script>'],
    ['<style>', '</style>'],
    ['<!--', '-->'],
    ['<?review', '?>'],
    ['<!DOCTYPE', '>'],
    ['<![CDATA[', ']]>'],
    ['<div>', '</div>'],
    ['<custom-tag>', '</custom-tag>'],
    ['<span>', '</span>'],
  ];
  const tails = [
    '    CODE',
    '    <object>CODE</object>',
    '~~~html\n<object>CODE</object>\n~~~',
    '```js\nSAMPLE\n```',
    'Use `<script>INLINE</script>` here.',
    '\t<object>CODE</object>',
  ];
  const cases: string[] = [];
  for (const [open, close] of openers)
    for (const tag of targets)
      for (const tail of tails)
        for (const gap of ['', '\n', 'PROSE\n\n'])
          for (const wrap of wrappers)
            for (const body of [`${open}<${tag}>BODY</${tag}>\n${gap}${tail}`, `${open}\n<${tag}>BODY</${tag}>\n${close}\n${gap}${tail}`])
              cases.push(wrap(body));
  // Fixed seed changes execution order without changing the reviewer's matrix.
  let seed = 0x63_36_52_bb;
  for (let i = cases.length - 1; i > 0; i--) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    const j = (seed >>> 0) % (i + 1);
    const original = cases[i] as string;
    cases[i] = cases[j] as string;
    cases[j] = original;
  }
  return cases;
};

export const exportContentHazardCases = (): string[] => {
  const cases: string[] = [];
  const payloads = [
    'BODY</textarea><img src=x onerror="NEW_ATTACK()">',
    'BODY</div><a href="javascript:NEW_ATTACK()">LINK</a>',
    'BODY</span><img src="data:text/html,NEW_ATTACK" onerror="NEW_ATTACK()">',
    '<img src=x onerror="NEW_ATTACK()"><a href="data:text/html,NEW_ATTACK">LINK</a>',
    '<object data="javascript:NEW_ATTACK()">FALLBACK</object>',
  ];
  for (const tag of targets)
    for (const name of [tag, tag.toUpperCase(), tag[0]?.toUpperCase() + tag.slice(1)])
      for (const payload of payloads)
        for (const wrap of wrappers) for (const prefix of ['', 'PREFIX ']) cases.push(wrap(`${prefix}<${name}>${payload}</${name}>\n    CODE`));
  for (const tag of targets)
    for (const close of ['textarea', 'div', 'span', 'pre', 'script', 'style'])
      for (const wrap of [wrappers[0], wrappers[1], wrappers[3], wrappers[7]])
        for (const code of ['    CODE', '    <object>CODE</object>', '~~~\nCODE\n~~~'])
          for (const name of [tag, tag.toUpperCase()])
            for (const gap of ['', '\n']) {
              if (wrap)
                cases.push(
                  wrap(
                    `<${name}>BODY\n</${close}>\n${code}\n${gap}<img src=x onerror="NEW_ATTACK()"><a href="data:text/html,NEW_ATTACK">LINK</a>\n</${name}>`,
                  ),
                );
            }
  for (const tag of ['script', 'style', 'iframe'])
    for (const wrap of wrappers)
      for (const body of ['<pre>\n\n<img onerror="NEW_UNCLOSED()">', '<img onerror="NEW_UNCLOSED()">', '[LINK](data:text/html,NEW_UNCLOSED)'])
        cases.push(wrap(`<${tag}>\n${body}\n\n    CODE`));
  return cases;
};
