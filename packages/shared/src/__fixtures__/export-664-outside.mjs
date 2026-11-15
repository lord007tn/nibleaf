// Compare all root groups outside the owned blocks, including list tightness,
// inline roles/attrs, and exact code tuples. Offset shifts are the only omission.
function rootGroups(source, tokens, regions) {
  const starts = [0];
  for (let i = 0; i < source.length; i++)
    if (source[i] === '\r' || source[i] === '\n') {
      if (source[i] === '\r' && source[i + 1] === '\n') i++;
      starts.push(i + 1);
    }
  const result = [];
  // Canonical rescue adds documented boundary newlines. An adjacent raw HTML
  // token can consume one in its content without changing its role/structure.
  // Exact canonical-output/byte checks separately forbid other outside edits.
  const shape = (t) => [
    t.type,
    t.tag,
    t.nesting,
    t.hidden,
    t.type === 'html_block' ? t.content.replace(/[\r\n]+$/, '') : t.content,
    t.markup,
    t.info,
    t.attrs,
    t.children?.map(shape),
  ];
  for (let i = 0; i < tokens.length; i++) {
    const group = [tokens[i]];
    if (tokens[i].nesting === 1) {
      let depth = 1;
      while (depth && i + 1 < tokens.length) {
        const t = tokens[++i];
        group.push(t);
        depth += t.nesting;
      }
    }
    const mapped = group.filter((t) => t.map);
    const from = Math.min(...mapped.map((t) => starts[t.map[0]] ?? source.length)),
      to = Math.max(...mapped.map((t) => starts[t.map[1]] ?? source.length));
    if (regions.some((r) => from < r.to && to > r.from)) continue;
    result.push(group.map(shape));
  }
  return JSON.stringify(result);
}
export function checkOutside(model, output, before, after, decode) {
  const owners = model.rescue ?? model.literal ?? [],
    outOwners = [];
  let at = 0,
    cursor = 0;
  for (const r of owners) {
    at += r.from - cursor;
    const value = Array.from(decode(model.source.slice(r.from, r.to)), (c) =>
      (c >= 'a' && c <= 'z') ||
      (c >= 'A' && c <= 'Z') ||
      (c >= '0' && c <= '9') ||
      c.codePointAt(0) > 127 ||
      (c.codePointAt(0) < 32 && !['\t', '\n', '\r'].includes(c)) ||
      c === '\x7f'
        ? c
        : `&#${c.codePointAt(0)};`,
    ).join('');
    // Boundary separators may be consumed into the preceding root's line map.
    // They do not own that root: only the literal payload is an output owner.
    const before = model.source.slice(0, r.from);
    const ending = before.endsWith('\r\n')
      ? '\r\n'
      : before.endsWith('\r')
        ? '\r'
        : before.endsWith('\n')
          ? '\n'
          : (model.source.slice(r.from).match(/\r\n|\r|\n/)?.[0] ?? '\n');
    outOwners.push({ from: at + ending.length, to: at + value.length + ending.length });
    at += value.length + 3 * ending.length;
    cursor = r.to;
  }
  return rootGroups(model.source, before, owners) === rootGroups(output, after, outOwners);
}
