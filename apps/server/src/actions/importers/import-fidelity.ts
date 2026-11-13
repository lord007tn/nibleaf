import { protectMarkdownCode } from '@nibleaf/shared/markdown-code';
import { forwardIndexOf, matchTags } from '@nibleaf/shared/markup-scan';
import { scanAuthoredEmbeds } from '@nibleaf/shared/reader-embeds';
import { isAllowedMediaUrl, parseVideoUrl, videoEmbedSrc } from '@nibleaf/shared/video-embeds';

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

/** A source-declared embed. HTTPS frames outside the player allowlist remain link cards. */
export const importEmbed = (url: string, title: string, onUnmapped: (url: string) => void, kind?: 'video' | 'iframe'): string => {
  const label = title.trim() || 'Video';
  if (isAllowedMediaUrl(url)) {
    const video = parseVideoUrl(url);
    if (video) return `<iframe src="${attr(videoEmbedSrc(video))}" title="${attr(label)}"></iframe>`;
    if (kind === 'video' || /\.(?:mp4|webm|ogg)(?:[?#]|$)/i.test(url)) return `<video controls src="${attr(url)}" title="${attr(label)}"></video>`;
  }
  onUnmapped(url);
  // Keep the source for the writer to repair; the reader handles unsafe frames as text.
  return `<iframe src="${attr(url)}" title="${attr(label)}"></iframe>`;
};

/** Normalize source media and escaped block markers outside code. Scans are forward-only. */
export const normalizeImportFidelity = (source: string, onUnmapped: (url: string) => void = () => undefined): string => {
  const protectedCode = protectMarkdownCode(source, { maxFenceIndent: Number.POSITIVE_INFINITY });
  const prose = protectedCode.content;
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
      if (line.startsWith('<Frame')) caption = /\bcaption=(["'])(.*?)\1/.exec(line)?.[2]?.slice(0, 300) ?? '';
      else if (line.startsWith('</Frame>')) caption = '';
      if (line && !line.startsWith('<') && line !== '/') preceding = line.replace(/^#{1,6}\s+/, '').slice(0, 300);
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
      if (!sources.length || sources.some((tag) => !isAllowedMediaUrl(/\bsrc\s*=\s*["']([^"']*)["']/i.exec(tag[0])?.[1]))) onUnmapped(url);
      output.push(`<video controls>${children}`);
    } else {
      const mapped = importEmbed(
        url,
        embed.attributes.get('title')?.trim() || decodeImportEntities(caption || preceding || 'Video'),
        onUnmapped,
        embed.kind,
      );
      const children = prose.slice(embed.openEnd, embed.end).replace(/<\/video>$/i, '');
      output.push(
        embed.kind === 'video' && mapped.startsWith('<video') && children.trim() ? mapped.replace('</video>', `${children}</video>`) : mapped,
      );
    }
    cursor = embed.end;
  }
  output.push(prose.slice(cursor));
  const lines = output.join('').split('\n');
  let title = '';
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]?.trim() ?? '';
    if (line === '<p>---</p>' || line === '\\---' || line === '\\-\\-\\-') lines[index] = '\n---\n';
    // A standalone provider link is how Markdown sources declare a video block.
    const link = /^\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)$/.exec(line);
    const bare = line.startsWith('https://') || (line.startsWith('<https://') && line.endsWith('>')) ? line.replace(/^<|>$/g, '') : '';
    const url = link?.[2] ?? bare;
    if (url && isAllowedMediaUrl(url) && (parseVideoUrl(url) || /\.(?:mp4|webm|ogg)(?:[?#]|$)/i.test(url))) {
      lines[index] = importEmbed(url, decodeImportEntities(link?.[1] || title || 'Video'), onUnmapped);
    } else if (line && !line.startsWith('<') && line !== '/') title = line.slice(0, 300);
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
  return normalized === prose ? source : protectedCode.restore(normalized.replace(/\n{3,}/g, '\n\n')).trim();
};
