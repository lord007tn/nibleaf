import { protectMarkdownCode } from '@nibleaf/shared/markdown-code';
import { markdownAndHtmlImages, replaceMarkdownImages, replaceTags } from '@nibleaf/shared/markup-scan';

/** The dark-mode twin of a light/dark image pair (`hidden dark:block`): the
 *  reader sees one screenshot, not two. */
const isDarkModeTwin = (image: string): boolean => {
  // class="…", className="…" or className={"…"}
  const classes = image.match(/\bclass(?:Name)?=\{?["']([^"']*)["']\}?/)?.[1]?.split(/\s+/) ?? [];
  return classes.includes('hidden') && classes.some((name) => name.startsWith('dark:') && name !== 'dark:hidden');
};

/**
 * The article meta line's numbers: minutes to read (220 words a minute, at
 * least one) and screenshots shown (a light/dark pair counts once). Both read
 * the whole page, which can be 2 MiB, in linear time.
 */
export const articleStats = (content: string): { readingMinutes: number; imageCount: number } => {
  const readableText = replaceMarkdownImages(replaceTags(content, /<[^>]+>/g, ' '), ' ').replace(/[`#*_>[\](){}|~-]/g, ' ');
  return {
    readingMinutes: Math.max(1, Math.ceil(readableText.split(/\s+/).filter(Boolean).length / 220)),
    imageCount: markdownAndHtmlImages(protectMarkdownCode(content).content).filter((image) => !isDarkModeTwin(image)).length,
  };
};
