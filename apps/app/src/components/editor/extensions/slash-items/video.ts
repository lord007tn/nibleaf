import { Code2, Video } from 'lucide-react';
import type { SlashItem } from './types';

/** The Video and Embed blocks (extensions/video-embed.ts). Each opens with its address field focused. */
export const videoSlashItems: SlashItem[] = [
  {
    titleKey: 'editor.slash.video.title',
    descKey: 'editor.slash.video.desc',
    icon: Video,
    glyph: '▶',
    keywords: ['video', 'youtube', 'vimeo', 'loom', 'wistia', 'mp4', 'webm', 'movie', 'embed', 'iframe', 'player'],
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'videoEmbed', attrs: { intent: 'video', focus: 'url' } })
        .run(),
  },
  {
    titleKey: 'editor.slash.embed.title',
    descKey: 'editor.slash.embed.desc',
    icon: Code2,
    glyph: '</>',
    keywords: ['embed', 'iframe', 'frame', 'widget', 'map', 'codepen', 'figma'],
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: 'videoEmbed', attrs: { intent: 'embed', focus: 'url' } })
        .run(),
  },
];
