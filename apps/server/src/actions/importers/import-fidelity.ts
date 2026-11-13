import { forwardIndexOf, matchTags } from '@nibleaf/shared/markup-scan';
import { scanAuthoredEmbeds, withEmbedAttribute } from '@nibleaf/shared/reader-embeds';
import { isAllowedMediaUrl, parseVideoUrl, videoEmbedSrc } from '@nibleaf/shared/video-embeds';
import { protectImportCode } from './import-markdown-code';

export interface ImportFidelityIssue {
  kind: 'embed' | 'link';
  page: string;
  reference: string;
}

export const decodeImportEntities = (value: string): string =>
  value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Math.min(0x10_ff_ff, Number.parseInt(hex, 16))))
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Math.min(0x10_ff_ff, Number(decimal))))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

const attr = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

// Keep rejected bytes inert even when the shared URL parser would trim them.
export const isImportMediaUrl = (url: string): boolean => {
  if (!isAllowedMediaUrl(url)) return false;
  for (let index = 0; index < url.length; index++) {
    const code = url.charCodeAt(index);
    if (code <= 32 || code === 127) return false;
  }
  return true;
};

/** A source-declared embed. HTTPS frames outside the player allowlist remain link cards. */
export const importEmbed = (url: string, title: string, onUnmapped: (url: string) => void, kind?: 'video' | 'iframe'): string => {
  const label = title.trim() || 'Video';
  if (!isImportMediaUrl(url)) {
    onUnmapped(url);
    return `<code>${attr(label)}: ${attr(url).replaceAll('>', '&gt;')}</code>`;
  }
  const video = parseVideoUrl(url);
  if (video) return `<iframe src="${attr(videoEmbedSrc(video))}" title="${attr(label)}"></iframe>`;
  if (kind === 'video' || /\.(?:mp4|webm|ogg)(?:[?#]|$)/i.test(url)) return `<video controls src="${attr(url)}" title="${attr(label)}"></video>`;
  onUnmapped(url);
  // A guarded HTTPS frame outside the player allowlist becomes a reader link card.
  return `<iframe src="${attr(url)}" title="${attr(label)}"></iframe>`;
};

/** The reader deliberately refuses a raw `<` in attributes. Inspect those
 * bounded openers without mistaking a data URL's markup for another video. */
const inertRejectedOpeners = (source: string, onUnmapped: (url: string) => void): string => {
  const lower = source.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  const closers = { iframe: forwardIndexOf(lower, '</iframe>'), video: forwardIndexOf(lower, '</video>') };
  const blankLines = [...source.matchAll(/\n[ \t]*\r?\n/g)].map((match) => match.index);
  let blankIndex = 0;
  const output: string[] = [];
  const openings = /<(iframe|video)\b/gi;
  let copied = 0;
  for (let match = openings.exec(source); match; match = openings.exec(source)) {
    const name = match[1]?.toLowerCase() === 'video' ? 'video' : 'iframe';
    let quote = '';
    let end = openings.lastIndex;
    const limit = Math.min(source.length, end + 4096);
    for (; end < limit; end++) {
      const character = source[end];
      if (quote) {
        if (character === quote) quote = '';
      } else if (character === '"' || character === "'") quote = character;
      else if (character === '>') {
        end++;
        break;
      } else if (character === '<') break;
    }
    if (source[end - 1] !== '>') continue;
    const opener = source.slice(match.index, end);
    const readable = `<${opener.slice(1).replaceAll('<', '&lt;')}`;
    const src = scanAuthoredEmbeds(readable)[0]?.attributes.get('src');
    if (!opener.includes('<', 1) || src === undefined || isImportMediaUrl(src)) {
      openings.lastIndex = end;
      continue;
    }
    const close = closers[name](end);
    while ((blankLines[blankIndex] ?? Number.POSITIVE_INFINITY) < end) blankIndex++;
    const pairEnd = close < 0 || close >= (blankLines[blankIndex] ?? Number.POSITIVE_INFINITY) ? end : close + name.length + 3;
    onUnmapped(src);
    output.push(source.slice(copied, match.index), `<code>${attr(source.slice(match.index, pairEnd)).replaceAll('>', '&gt;')}</code>`);
    copied = pairEnd;
    openings.lastIndex = pairEnd;
  }
  output.push(source.slice(copied));
  return output.join('');
};

/** Normalize source media and escaped block markers outside code. Scans are forward-only. */
export const normalizeImportFidelity = (source: string, onUnmapped: (url: string) => void = () => undefined): string => {
  const protectedCode = protectImportCode(source);
  const prose = inertRejectedOpeners(protectedCode.content, onUnmapped);
  const embeds = scanAuthoredEmbeds(prose);
  let embedIndex = 0;
  for (const opener of prose.matchAll(/<(?:iframe|video)\b/gi)) {
    while (embeds[embedIndex] && (embeds[embedIndex]?.end ?? 0) <= opener.index) embedIndex++;
    const scanned = embeds[embedIndex];
    if (!scanned || opener.index < scanned.start) onUnmapped(prose.slice(opener.index, opener.index + 200));
  }
  const output: string[] = [];
  const nextLineEnd = forwardIndexOf(prose, '\n');
  let cursor = 0;
  let lineStart = 0;
  let preceding = '';
  let caption = '';
  for (const embed of embeds) {
    // Maintain surrounding prose once, rather than searching the page for every embed.
    while (lineStart < embed.start) {
      const end = nextLineEnd(lineStart);
      if (end < 0 || end >= embed.start) break;
      const line = prose.slice(lineStart, end).trim();
      if (line.startsWith('<Frame')) caption = line.includes('\uE000') ? '' : (/\bcaption=(["'])(.*?)\1/.exec(line)?.[2]?.slice(0, 300) ?? '');
      else if (line.startsWith('</Frame>')) caption = '';
      if (line && !line.includes('\uE000') && !line.startsWith('<') && line !== '/') preceding = line.replace(/^#{1,6}\s+/, '').slice(0, 300);
      lineStart = end + 1;
    }
    const url = embed.attributes.get('src') ?? '';
    output.push(prose.slice(cursor, embed.start));
    if (!embed.closed) {
      onUnmapped(url);
      output.push(prose.slice(embed.start, embed.end));
    } else if (embed.kind === 'video' && !url) {
      // A source/track video is already canonical HTML; preserve its alternatives and captions.
      const children = prose.slice(embed.openEnd, embed.end);
      const sources = matchTags(children, /<source\b[^<>]*>/gi);
      if (
        !sources.length ||
        sources.some((tag) => !isImportMediaUrl(decodeImportEntities(/\bsrc\s*=\s*["']([^"']*)["']/i.exec(tag[0])?.[1] ?? '')))
      ) {
        onUnmapped(url);
        output.push(`<code>${attr(prose.slice(embed.start, embed.end)).replaceAll('>', '&gt;')}</code>`);
      } else {
        const opener = prose.slice(embed.start, embed.openEnd);
        output.push((embed.attributes.has('controls') ? opener : withEmbedAttribute(opener, 'controls', 'true')) ?? opener, children);
      }
    } else {
      const title = embed.attributes.get('title')?.trim() || decodeImportEntities(caption || preceding || 'Video');
      const mapped = importEmbed(url, title, onUnmapped, embed.kind);
      if (embed.kind === 'video' && mapped.startsWith('<video')) {
        let opener = prose.slice(embed.start, embed.openEnd);
        if (!embed.attributes.has('controls')) opener = withEmbedAttribute(opener, 'controls', 'true') ?? opener;
        if (!embed.attributes.get('title')?.trim()) opener = withEmbedAttribute(opener, 'title', title) ?? opener;
        output.push(opener, prose.slice(embed.openEnd, embed.end));
      } else output.push(mapped);
    }
    cursor = embed.end;
  }
  output.push(prose.slice(cursor));
  const lines = output.join('').split('\n');
  let title = '';
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index] ?? '';
    const prefix = /^[\t >]*/.exec(raw)?.[0] ?? '';
    const line = raw.slice(prefix.length).trimEnd();
    if (line === '<p>---</p>' || line === '\\---' || line === '\\-\\-\\-') lines[index] = `${prefix}\n${prefix}---\n${prefix}`;
    // A standalone provider link is how Markdown sources declare a video block.
    const link = /^\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)$/.exec(line);
    const bare = line.startsWith('https://') || (line.startsWith('<https://') && line.endsWith('>')) ? line.replace(/^<|>$/g, '') : '';
    const url = link?.[2] ?? bare;
    if (url && isImportMediaUrl(url) && (parseVideoUrl(url) || /\.(?:mp4|webm|ogg)(?:[?#]|$)/i.test(url))) {
      const label = link?.[1]?.includes('\uE000') ? '' : link?.[1];
      lines[index] = prefix + importEmbed(url, decodeImportEntities(label || title || 'Video'), onUnmapped);
    } else if (line && !line.includes('\uE000') && !line.startsWith('<') && line !== '/') title = line.slice(0, 300);
  }
  // Only an otherwise empty paragraph immediately beside a retained embed is an artifact.
  let previous = -1;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]?.trim() ?? '';
    if (!line) continue;
    if (previous >= 0) {
      const prior = lines[previous]?.trim() ?? '';
      if (line === '</Frame>' && /<\/(?:iframe|video)>$/.test(prior)) continue;
      if (/^<Frame\b/.test(line) && (prior === '/' || prior === '<p>/</p>')) continue;
      if ((line === '/' || line === '<p>/</p>') && /<\/(?:iframe|video)>$/.test(prior)) lines[index] = '';
      else if ((prior === '/' || prior === '<p>/</p>') && /^<(?:iframe|video)\b/.test(line)) lines[previous] = '';
    }
    previous = index;
  }
  const normalized = lines.join('\n');
  return normalized === protectedCode.content ? source : protectedCode.restore(normalized.replace(/\n{3,}/g, '\n\n').trim());
};
