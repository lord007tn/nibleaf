import type { Element, ElementContent, Root } from 'hast';

/** Split recursively so a multiline comment/string retains its token class on every line. */
function split(nodes: ElementContent[]): ElementContent[][] {
  const lines: ElementContent[][] = [[]];
  for (const node of nodes) {
    const parts: ElementContent[][] =
      node.type === 'text'
        ? node.value.split('\n').map((value) => [{ type: 'text', value }])
        : node.type === 'element'
          ? split(node.children).map((children) => [{ ...node, children }])
          : [[node]];
    parts.forEach((part, index) => {
      if (index) lines.push([]);
      lines[lines.length - 1]?.push(...part);
    });
  }
  return lines;
}

export function rehypeCodeLines() {
  return (tree: Root) => {
    function visit(node: Root | Element) {
      if (node.type === 'element' && node.tagName === 'pre') {
        const code = node.children.find((child): child is Element => child.type === 'element' && child.tagName === 'code');
        if (!code) return;
        const props = { ...node.properties, ...code.properties };
        if (!props.dataLines && !props.dataHighlight && !props.dataFocus && !props.dataDiff && !props.dataExpandable) return;
        const highlighted = String(props.dataHighlight ?? '').split(',');
        const focused = String(props.dataFocus ?? '').split(',');
        const diffs = String(props.dataDiff ?? '').split(',');
        const hasDiff = diffs.some(Boolean);
        code.properties.dataCodeLines = 'true';
        const lines = split(code.children);
        // mdast adds a terminal newline. Preserve it outside the last visible line.
        const trailing = lines.at(-1)?.every((child) => child.type === 'text' && child.value === '');
        if (trailing) lines.pop();
        code.children = lines.flatMap((children, index): ElementContent[] => {
          const number = String(index + 1);
          const gutter: Element = {
            type: 'element',
            tagName: 'span',
            properties: {
              className: ['code-gutter'],
              ariaHidden: 'true',
              dataNumber: props.dataLines ? number : undefined,
              dataDiff: hasDiff ? diffs[index] || 'none' : undefined,
            },
            children: [],
          };
          return [
            {
              type: 'element',
              tagName: 'span',
              properties: {
                className: ['code-line'],
                dataHighlight: highlighted.includes(number) ? 'true' : undefined,
                dataDim: props.dataFocus && !focused.includes(number) ? 'true' : undefined,
                dataDiff: diffs[index] || undefined,
              },
              children: [...(props.dataLines || hasDiff ? [gutter] : []), ...children],
            },
            ...(index < lines.length - 1 || trailing ? [{ type: 'text' as const, value: '\n' }] : []),
          ];
        });
        return;
      }
      for (const child of node.children) if (child.type === 'element') visit(child);
    }
    visit(tree);
  };
}
