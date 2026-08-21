export interface ChangelogRssEntry {
  version: number;
  date: Date | string | null;
  title: string;
  pages: number;
}

const escapeXml = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');

const rfc822 = (value: Date | string | null): string | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toUTCString();
};

/** Build a deterministic RSS 2.0 release feed from immutable READY deployments. */
export const buildChangelogRss = ({
  baseUrl,
  description,
  entries,
  title,
}: {
  baseUrl: string;
  description: string;
  entries: ChangelogRssEntry[];
  title: string;
}): string => {
  const changelogUrl = `${baseUrl.replace(/\/$/, '')}/changelog`;
  const items = entries.map((entry) => {
    const link = `${changelogUrl}#release-v${entry.version}`;
    const date = rfc822(entry.date);
    return [
      '    <item>',
      `      <title>${escapeXml(entry.title)}</title>`,
      `      <link>${escapeXml(link)}</link>`,
      `      <guid isPermaLink="true">${escapeXml(link)}</guid>`,
      date ? `      <pubDate>${date}</pubDate>` : null,
      `      <description>${escapeXml(entry.title)}</description>`,
      '    </item>',
    ]
      .filter(Boolean)
      .join('\n');
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${escapeXml(`${title} changelog`)}</title>`,
    `    <link>${escapeXml(changelogUrl)}</link>`,
    `    <description>${escapeXml(description)}</description>`,
    `    <atom:link href="${escapeXml(`${changelogUrl}/rss.xml`)}" rel="self" type="application/rss+xml" />`,
    ...items,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');
};
