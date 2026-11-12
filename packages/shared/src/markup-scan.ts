/**
 * Linear tag and link scanning for content up to 2 MiB.
 *
 * Each function here gives exactly what the regex in its comment gives
 * (markup-scan.test.ts compares them on generated input), and reads each
 * character a bounded number of times.
 */

type Replacer = (match: string, ...groups: string[]) => string;

/** `text.indexOf(search, from)` for a scan whose `from` only moves forward: the
 *  last answer is reused while it still holds, so the whole scan reads the text once. */
export const forwardIndexOf = (text: string, search: string): ((from: number) => number) => {
  let lastFrom = 0;
  let lastFound = -2;
  return (from) => {
    if (lastFound !== -2 && from >= lastFrom && (lastFound === -1 || from <= lastFound)) return lastFound;
    lastFrom = from;
    lastFound = text.indexOf(search, from);
    return lastFound;
  };
};

/** The scanned part of `text` for a pattern whose every match ends at the first
 *  `>` after its start: nothing after the last `>` can match, and before it
 *  every opener finds its `>`. */
const throughLastClose = (text: string): number => text.lastIndexOf('>') + 1;

/**
 * `text.replace(pattern, replacement)` for a global pattern whose every match
 * ends at the first `>` after where it starts: `/<[^>]+>/g`,
 * `/<\/?[A-Za-z][^>]*>/g`, `/<img\b[^>]*>/gi`. Same result, linear time: such a
 * regex can only fail where no `>` is left, so the text after the last `>` is
 * left out of the scan.
 */
export const replaceTags = (text: string, pattern: RegExp, replacement: string | Replacer): string => {
  const end = throughLastClose(text);
  if (end === 0) return text;
  const head = text.slice(0, end);
  if (typeof replacement === 'string') return head.replace(pattern, replacement) + text.slice(end);
  // The replacer gets the match and its groups (not the offset or the scanned text).
  const groups = (new RegExp(`${pattern.source}|`).exec('')?.length ?? 1) - 1;
  return head.replace(pattern, (match: string, ...rest: unknown[]) => replacement(match, ...(rest.slice(0, groups) as string[]))) + text.slice(end);
};

/** `[...text.matchAll(pattern)]` for the patterns `replaceTags` takes. */
export const matchTags = (text: string, pattern: RegExp): RegExpMatchArray[] => [...text.slice(0, throughLastClose(text)).matchAll(pattern)];

/**
 * `text.replace(pattern, replacer)` for a pattern that opens a tag, reads
 * `[^>]*` up to some required text and may continue past it:
 * `/(<a\b[^>]*\bhref=")([^"]*)(")/gi`. Same result, linear time. Where the
 * regex fails at one opener, it fails at every opener before the next `>` too:
 * they see a subset of the same text up to that `>` and the same text after it.
 * So the scan moves on to that `>` instead of trying each one.
 *
 * `opener` (global) must match exactly where `pattern` (sticky, same flags)
 * can start, e.g. `/<a\b/gi` for the pattern above.
 */
export const replaceTagAttributes = (text: string, opener: RegExp, pattern: RegExp, replacer: Replacer): string => {
  const nextClose = forwardIndexOf(text, '>');
  let out = '';
  let copied = 0;
  let from = 0;
  for (;;) {
    opener.lastIndex = from;
    const start = opener.exec(text)?.index;
    if (start === undefined) break;
    pattern.lastIndex = start;
    const match = pattern.exec(text);
    if (match) {
      out += text.slice(copied, start) + replacer(match[0], ...match.slice(1).map((group) => group ?? ''));
      copied = start + match[0].length;
      from = copied;
      continue;
    }
    const close = nextClose(start);
    if (close === -1) break;
    from = close + 1;
  }
  return out + text.slice(copied);
};

/** Markdown `[label](target)` shapes that start with `prefix` (`![` for images,
 *  `[` for links). `onMatch` gets the start, the `]` and the `)`. */
const scanBracketLinks = (
  text: string,
  prefix: '![' | '[',
  requireLabel: boolean,
  onMatch: (start: number, close: number, end: number) => void,
): void => {
  const nextBracket = forwardIndexOf(text, ']');
  const nextParen = forwardIndexOf(text, ')');
  let from = 0;
  for (;;) {
    const start = text.indexOf(prefix, from);
    if (start === -1) return;
    const labelStart = start + prefix.length;
    // `[^\]]+` needs one character that isn't `]`.
    if (requireLabel && (labelStart >= text.length || text[labelStart] === ']')) {
      from = start + 1;
      continue;
    }
    const close = nextBracket(labelStart);
    // No `]` left: nothing after this can close.
    if (close === -1) return;
    // Every opener before this `]` reads up to the same `]`, so all of them fail here.
    if (text[close + 1] !== '(') {
      from = close + 1;
      continue;
    }
    const end = nextParen(close + 2);
    // No `)` left: no later opener can close either.
    if (end === -1) return;
    onMatch(start, close, end);
    from = end + 1;
  }
};

/** `text.replace(/!\[[^\]]*\]\([^)]*\)/g, replacement)`, in linear time. */
export const replaceMarkdownImages = (text: string, replacement: string): string => {
  let out = '';
  let copied = 0;
  scanBracketLinks(text, '![', false, (start, _close, end) => {
    out += text.slice(copied, start) + replacement;
    copied = end + 1;
  });
  return out + text.slice(copied);
};

/** `text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')`: links read as their label, in linear time. */
export const replaceMarkdownLinksWithLabels = (text: string): string => {
  let out = '';
  let copied = 0;
  scanBracketLinks(text, '[', true, (start, close, end) => {
    out += text.slice(copied, start) + text.slice(start + 1, close);
    copied = end + 1;
  });
  return out + text.slice(copied);
};

/** `/[\s)]/g` from `from`, cached the way `forwardIndexOf` is. */
const forwardTargetStop = (text: string): ((from: number) => number) => {
  const stop = /[\s)]/g;
  let lastFrom = 0;
  let lastFound = -2;
  return (from) => {
    if (lastFound !== -2 && from >= lastFrom && (lastFound === -1 || from <= lastFound)) return lastFound;
    lastFrom = from;
    stop.lastIndex = from;
    lastFound = stop.exec(text)?.index ?? -1;
    return lastFound;
  };
};

/**
 * `text.replace(/(!\[[^\]]*\]\()([^\s)]+)((?:\s+["'][^)]*["'])?\))/g, replacer)`:
 * each Markdown image as its `![alt](` part, its target and the rest (an
 * optional quoted title and the `)`), in linear time.
 */
export const replaceMarkdownImageTargets = (text: string, replacer: (before: string, target: string, after: string) => string): string => {
  const nextBracket = forwardIndexOf(text, ']');
  const nextParen = forwardIndexOf(text, ')');
  const nextStop = forwardTargetStop(text);
  // The title check for one stop, kept: openers whose targets end at the same stop share it.
  let titleStop = -1;
  let titleEnd = -1;
  const titleEndAt = (stop: number): number => {
    if (stop === titleStop) return titleEnd;
    let quote = stop;
    while (quote < text.length && /\s/.test(text[quote] as string)) quote += 1;
    const paren = text[quote] === '"' || text[quote] === "'" ? nextParen(quote + 1) : -1;
    titleStop = stop;
    titleEnd = paren > quote + 1 && (text[paren - 1] === '"' || text[paren - 1] === "'") ? paren + 1 : -1;
    return titleEnd;
  };
  let out = '';
  let copied = 0;
  let from = 0;
  for (;;) {
    const start = text.indexOf('![', from);
    if (start === -1) break;
    const close = nextBracket(start + 2);
    if (close === -1) break;
    // Every opener before this `]` reads the same `](…` after it, so they all match or fail alike.
    if (text[close + 1] !== '(') {
      from = close + 1;
      continue;
    }
    const targetStart = close + 2;
    const stop = nextStop(targetStart);
    // No space or `)` left: no target can end, here or later.
    if (stop === -1) break;
    let end = -1;
    // `\s+["'][^)]*["']\)` when the target stops at a space: a title closing right before the next `)`.
    if (stop > targetStart) end = text[stop] === ')' ? stop + 1 : titleEndAt(stop);
    if (end === -1) {
      from = close + 1;
      continue;
    }
    out += text.slice(copied, start) + replacer(text.slice(start, targetStart), text.slice(targetStart, stop), text.slice(stop, end));
    copied = end;
    from = end;
  }
  return out + text.slice(copied);
};

/**
 * `text.replace(/<(name|…)[\s\S]*?<\/\1>/gi, replacement)` for the given
 * lowercase tag names: each element, from its opener to its own close tag, in
 * linear time. An opener with no close tag after it means no later opener of
 * that name has one either.
 */
export const replaceElements = (text: string, names: readonly string[], replacement: string): string => {
  const opener = new RegExp(`<(${names.join('|')})`, 'gi');
  const closers = new Map(names.map((name) => [name, new RegExp(`</${name}>`, 'gi')]));
  const lastClose = new Map(names.map((name) => [name, -2]));
  let out = '';
  let copied = 0;
  for (;;) {
    const open = opener.exec(text);
    if (!open) break;
    const name = (open[1] as string).toLowerCase();
    const bodyStart = open.index + open[0].length;
    let close = lastClose.get(name) ?? -2;
    if (close !== -1 && close < bodyStart) {
      const closer = closers.get(name) as RegExp;
      closer.lastIndex = bodyStart;
      close = closer.exec(text)?.index ?? -1;
      lastClose.set(name, close);
    }
    if (close === -1) {
      // Nothing of this name can close any more; the regex moves on one character.
      opener.lastIndex = open.index + 1;
      continue;
    }
    const end = close + name.length + 3;
    out += text.slice(copied, open.index) + replacement;
    copied = end;
    opener.lastIndex = end;
  }
  return out + text.slice(copied);
};

/** `text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, replacement)`. */
export const replaceScriptAndStyleElements = (text: string, replacement: string): string => replaceElements(text, ['script', 'style'], replacement);

/**
 * `text.split(/<!--[\s\S]*?-->|\{\/\*[\s\S]*?\*\/\}/).some((part) => part.trim().length > 0)`:
 * whether anything but HTML/MDX comments and whitespace is left, read once.
 * An opener that never closes isn't a comment, so its own characters count.
 */
export const hasTextOutsideComments = (text: string): boolean => {
  const nextHtml = forwardIndexOf(text, '<!--');
  const nextMdx = forwardIndexOf(text, '{/*');
  const htmlClose = forwardIndexOf(text, '-->');
  const mdxClose = forwardIndexOf(text, '*/}');
  for (let from = 0; ; ) {
    const html = nextHtml(from);
    const mdx = nextMdx(from);
    const start = html === -1 ? mdx : mdx === -1 ? html : Math.min(html, mdx);
    if (start === -1) return /\S/.test(text.slice(from));
    if (/\S/.test(text.slice(from, start))) return true;
    const close = start === html ? htmlClose(start + 4) : mdxClose(start + 3);
    if (close === -1) return true;
    from = close + 3;
  }
};

/**
 * `text.replace(/\s*\n\s*\/g, '\n')`: every run of whitespace that holds a line
 * break becomes that one line break; other whitespace stays as it is. Each run
 * is read once.
 */
export const collapseLineBreakRuns = (text: string): string => text.replace(/\s+/g, (run) => (run.includes('\n') ? '\n' : run));

/**
 * Where `/(`+)[\s\S]*?\1/y` ends when tried at `start` (-1: no match), for
 * starts that never decrease. The backticks from `start` to the end of their
 * run open the span, as many as some later run can close (the first later run
 * at least that long closes it); when no later run is long enough, half of the
 * rest of the run closes against the other half. Runs are listed once.
 */
const codeSpanEnds = (text: string): ((start: number) => number) => {
  const starts: number[] = [];
  const lengths: number[] = [];
  for (let index = text.indexOf('`'); index !== -1; ) {
    let end = index + 1;
    while (text[end] === '`') end += 1;
    starts.push(index);
    lengths.push(end - index);
    index = text.indexOf('`', end);
  }
  // The longest run from each run on.
  const longestFrom: number[] = new Array(starts.length + 1).fill(0);
  for (let run = starts.length - 1; run >= 0; run -= 1) longestFrom[run] = Math.max(lengths[run] as number, longestFrom[run + 1] as number);
  let run = 0;
  return (start) => {
    while (run < starts.length && (starts[run] as number) + (lengths[run] as number) <= start) run += 1;
    const runStart = starts[run];
    if (runStart === undefined || runStart > start) return -1;
    const rest = runStart + (lengths[run] as number) - start;
    const ticks = Math.min(rest, longestFrom[run + 1] as number);
    if (2 * ticks > rest) {
      // The runs passed over here are inside the span, so the next start is past them.
      let close = run + 1;
      while ((lengths[close] as number) < ticks) close += 1;
      return (starts[close] as number) + ticks;
    }
    return rest >= 2 ? start + 2 * Math.floor(rest / 2) : -1;
  };
};

/** `[...text.matchAll(/(`+)[\s\S]*?\1/g)]` as `[start, end]` pairs: inline code spans, in linear time. */
export const inlineCodeSpans = (text: string): Array<[number, number]> => {
  const spanEnd = codeSpanEnds(text);
  const spans: Array<[number, number]> = [];
  for (let start = text.indexOf('`'); start !== -1; ) {
    const end = spanEnd(start);
    if (end === -1) {
      start = text.indexOf('`', start + 1);
      continue;
    }
    spans.push([start, end]);
    start = text.indexOf('`', end);
  }
  return spans;
};

/**
 * `[...text.matchAll(/(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g)]` as `[start, end]`
 * pairs: CommonMark-style code spans, closed by the next run of exactly the
 * opener's length. From each run the expression tries the whole run first,
 * then each shorter tail of it; the first length some later run has wins. The
 * next run of each length is read with a pointer that only moves forward, so
 * the scan is linear.
 */
export const markdownCodeSpans = (text: string): Array<[number, number]> => {
  const starts: number[] = [];
  const lengths: number[] = [];
  for (let index = text.indexOf('`'); index !== -1; ) {
    let end = index + 1;
    while (text[end] === '`') end += 1;
    starts.push(index);
    lengths.push(end - index);
    index = text.indexOf('`', end);
  }
  const runsOfLength = new Map<number, number[]>();
  for (let run = 0; run < lengths.length; run += 1) {
    const length = lengths[run] as number;
    const runs = runsOfLength.get(length);
    if (runs) runs.push(run);
    else runsOfLength.set(length, [run]);
  }
  const pointers = new Map<number, number>();
  const nextRunOfLength = (length: number, after: number): number => {
    const runs = runsOfLength.get(length);
    if (!runs) return -1;
    let at = pointers.get(length) ?? 0;
    while (at < runs.length && (runs[at] as number) <= after) at += 1;
    pointers.set(length, at);
    return runs[at] ?? -1;
  };
  const spans: Array<[number, number]> = [];
  for (let run = 0; run < starts.length; ) {
    const start = starts[run] as number;
    const length = lengths[run] as number;
    let close = -1;
    let skipped = 0;
    for (; skipped < length && close === -1; skipped += 1) close = nextRunOfLength(length - skipped, run);
    if (close === -1) {
      run += 1;
      continue;
    }
    spans.push([start + skipped - 1, (starts[close] as number) + (lengths[close] as number)]);
    run = close + 1;
  }
  return spans;
};

const WHITESPACE = /\s/;
const skipWhitespace = (text: string, from: number): number => {
  let index = from;
  while (index < text.length && WHITESPACE.test(text[index] as string)) index += 1;
  return index;
};

/**
 * `text.replace(/(`+)[\s\S]*?\1|\{\s*\/\*[\s\S]*?\*\/\s*\}/g, (match, code) => (code ? match : ''))`:
 * MDX comments removed and inline code spans kept as written, whichever starts
 * first, in linear time. When one comment finds no close, no later one can.
 */
export const removeMdxCommentsOutsideCode = (text: string): string => {
  const spanEnd = codeSpanEnds(text);
  const nextTick = forwardIndexOf(text, '`');
  const nextBrace = forwardIndexOf(text, '{');
  const nextClose = forwardIndexOf(text, '*/');
  let closes = true;
  let out = '';
  let copied = 0;
  for (let from = 0; ; ) {
    const tick = nextTick(from);
    const brace = nextBrace(from);
    const start = tick === -1 ? brace : brace === -1 ? tick : Math.min(tick, brace);
    if (start === -1) break;
    if (start === tick) {
      const end = spanEnd(start);
      from = end === -1 ? start + 1 : end;
      continue;
    }
    const opener = skipWhitespace(text, start + 1);
    let end = -1;
    if (closes && text.startsWith('/*', opener)) {
      for (let close = nextClose(opener + 2); close !== -1; close = nextClose(close + 2)) {
        const after = skipWhitespace(text, close + 2);
        if (text[after] === '}') {
          end = after + 1;
          break;
        }
      }
      closes = end !== -1;
    }
    if (end === -1) {
      from = start + 1;
      continue;
    }
    out += text.slice(copied, start);
    copied = end;
    from = end;
  }
  return out + text.slice(copied);
};

/** For each quote, the next quote of the same kind on its line (-1: none, or not a quote). */
const pairedQuotes = (text: string): Int32Array => {
  const paired = new Int32Array(text.length).fill(-1);
  let double = -1;
  let single = -1;
  for (let index = text.length - 1; index >= 0; index -= 1) {
    const char = text[index];
    if (char === '\n') {
      double = -1;
      single = -1;
    } else if (char === '"') {
      paired[index] = double;
      double = index;
    } else if (char === "'") {
      paired[index] = single;
      single = index;
    }
  }
  return paired;
};

/**
 * Tag attribute text, read one part at a time from `from`: a quote closed
 * later on its line is read through its close; any other character but `>` is
 * one part (a quote not closed on its line is an ordinary character). This is
 * `(?:[^>"']|"[^"\n]*"|'[^'\n]*'|"(?![^"\n]*")|'(?![^'\n]*'))`, where at each
 * position exactly one alternative can match. Gives the index after the part
 * starting at `at`, or -1 at a `>` or the end.
 */
const nextAttributePart = (text: string, paired: Int32Array, at: number): number => {
  const char = text[at];
  if (char === undefined || char === '>') return -1;
  const close = paired[at] as number;
  return close === -1 ? at + 1 : close + 1;
};

/**
 * `text.replace(new RegExp(`<(names)\\b(PART*?)\\/>`, 'gi'), (match, name, attributes) => replacer(name, attributes))`
 * with PART the attribute part above: self-closing tags of the given names,
 * in linear time. Reading attributes from a position always goes the same way,
 * so where it ends is kept for every position it passes.
 */
export const replaceSelfClosingTags = (text: string, names: readonly string[], replacer: (name: string, attributes: string) => string): string => {
  const opener = new RegExp(`<(${names.join('|')})\\b`, 'gi');
  let paired: Int32Array | null = null;
  // Per position: the index after the `/>` that reading from it reaches, -1 for none, 0 not read yet.
  let ends: Int32Array | null = null;
  const tagEnd = (from: number): number => {
    paired ??= pairedQuotes(text);
    ends ??= new Int32Array(text.length + 1);
    const passed: number[] = [];
    let at = from;
    let end = 0;
    while (end === 0) {
      end = ends[at] as number;
      if (end !== 0) break;
      passed.push(at);
      if (text.startsWith('/>', at)) end = at + 2;
      else {
        at = nextAttributePart(text, paired, at);
        if (at === -1) end = -1;
      }
    }
    for (const position of passed) ends[position] = end;
    return end;
  };
  let out = '';
  let copied = 0;
  for (;;) {
    const open = opener.exec(text);
    if (!open) break;
    const attributesStart = open.index + open[0].length;
    const end = tagEnd(attributesStart);
    if (end === -1) {
      opener.lastIndex = open.index + 1;
      continue;
    }
    out += text.slice(copied, open.index) + replacer(open[1] as string, text.slice(attributesStart, end - 2));
    copied = end;
    opener.lastIndex = end;
  }
  return out + text.slice(copied);
};

const LINE_TERMINATOR = /[\n\r\u2028\u2029]/;
const NON_SPACE = /\S/;
const asciiLowerCase = (text: string): string => text.replace(/[A-Z]/g, (char) => char.toLowerCase());

/**
 * `new RegExp(`^(\\s*)<(names)\\b(ATTRIBUTES)>(.*\\S.*)</\\2>\\s*$`, 'i').exec(line)`,
 * where ATTRIBUTES is `(?:PART*(?:PART but not /))?`: an element opened and
 * closed on one line, as its indent, name, attributes and body. Reading
 * attributes stops at one `>` only, and only one close tag can be followed by
 * nothing but whitespace, so each piece is found by one forward read.
 */
export const matchOneLineElement = (
  line: string,
  names: readonly string[],
): { indent: string; name: string; attributes: string; body: string } | null => {
  const indentEnd = skipWhitespace(line, 0);
  const open = new RegExp(`<(${names.join('|')})\\b`, 'iy');
  open.lastIndex = indentEnd;
  const opened = open.exec(line);
  if (!opened) return null;
  const name = opened[1] as string;
  const attributesStart = indentEnd + opened[0].length;
  const paired = pairedQuotes(line);
  let close = attributesStart;
  for (let next = nextAttributePart(line, paired, close); next !== -1; next = nextAttributePart(line, paired, close)) close = next;
  if (line[close] !== '>') return null;
  const attributes = line.slice(attributesStart, close);
  if (attributes.endsWith('/')) return null;
  const rest = line.slice(close + 1).trimEnd();
  const closeTag = `</${asciiLowerCase(name)}>`;
  if (rest.length < closeTag.length || asciiLowerCase(rest.slice(rest.length - closeTag.length)) !== closeTag) return null;
  const body = rest.slice(0, rest.length - closeTag.length);
  if (LINE_TERMINATOR.test(body) || !NON_SPACE.test(body)) return null;
  return { indent: line.slice(0, indentEnd), name, attributes, body };
};

const HTML_IMAGE_OPEN = /<img\b/gi;

/**
 * `text.match(/!\[[^\]]*\]\([^)]*\)|<img\b[^>]*>/gi) ?? []`: every Markdown
 * and HTML image, in order, in linear time.
 */
export const markdownAndHtmlImages = (text: string): string[] => {
  const found: string[] = [];
  const nextBracket = forwardIndexOf(text, ']');
  const nextParen = forwardIndexOf(text, ')');
  const nextClose = forwardIndexOf(text, '>');
  let from = 0;
  // The next place each kind could start (-1: none can match any more).
  let markdown = -2;
  let html = -2;
  for (;;) {
    if (markdown !== -1 && markdown < from) markdown = text.indexOf('![', from);
    if (html !== -1 && html < from) {
      HTML_IMAGE_OPEN.lastIndex = from;
      html = HTML_IMAGE_OPEN.exec(text)?.index ?? -1;
    }
    if (markdown === -1 && html === -1) return found;
    if (markdown !== -1 && (html === -1 || markdown < html)) {
      const close = nextBracket(markdown + 2);
      if (close === -1) {
        markdown = -1;
        continue;
      }
      if (text[close + 1] !== '(') {
        // Markdown openers before this `]` fail; HTML ones in between are still tried.
        markdown = text.indexOf('![', close + 1);
        continue;
      }
      const end = nextParen(close + 2);
      if (end === -1) {
        markdown = -1;
        continue;
      }
      found.push(text.slice(markdown, end + 1));
      from = end + 1;
      continue;
    }
    const close = nextClose(html);
    if (close === -1) {
      html = -1;
      continue;
    }
    found.push(text.slice(html, close + 1));
    from = close + 1;
  }
};
