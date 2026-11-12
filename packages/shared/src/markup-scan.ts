/**
 * Linear tag and link scanning for content up to 2 MiB.
 *
 * Each function here gives exactly what the regex in its comment gives
 * (markup-scan.test.ts compares them on generated input). A regex of the shape
 * `opener [^x]* x …` re-reads the rest of the text from every opener whenever
 * the `x` it needs is missing, so its time grows with the square of the text;
 * these scans read each character a bounded number of times instead.
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
 * `text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, replacement)`: each script
 * or style element, from its opening `<script`/`<style` to its own close tag,
 * in linear time. An opener with no close tag after it means no later opener of
 * that name has one either.
 */
export const replaceScriptAndStyleElements = (text: string, replacement: string): string => {
  const opener = /<(script|style)/gi;
  const closers = { script: /<\/script>/gi, style: /<\/style>/gi };
  const lastClose = { script: -2, style: -2 };
  let out = '';
  let copied = 0;
  for (;;) {
    const open = opener.exec(text);
    if (!open) break;
    const name = (open[1] as string).toLowerCase() as 'script' | 'style';
    const bodyStart = open.index + open[0].length;
    let close = lastClose[name];
    if (close !== -1 && close < bodyStart) {
      closers[name].lastIndex = bodyStart;
      close = closers[name].exec(text)?.index ?? -1;
      lastClose[name] = close;
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
