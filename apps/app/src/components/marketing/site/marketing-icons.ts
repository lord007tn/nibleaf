import { createLucideIcon } from 'lucide-react';

/**
 * Marketing copies of lucide icons that the public docs reader also uses.
 *
 * The bundler groups shared modules by the set of chunks that import them. When
 * a marketing page imports the same lucide module as the reader, the reader's
 * icon chunk is re-split, and every docs page pays for the extra chunk
 * boundaries. These copies use the same path data and `createLucideIcon`, so
 * they render identically while the reader's icon modules stay grouped as on
 * `main`. Icon data: lucide (ISC licence).
 */
export const PlayIcon = createLucideIcon({
  name: 'play',
  size: 24,
  node: [['path', { d: 'M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z', key: '10ikf1' }]],
});

export const MessageSquareIcon = createLucideIcon({
  name: 'message-square',
  size: 24,
  node: [
    [
      'path',
      {
        d: 'M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z',
        key: '18887p',
      },
    ],
  ],
});

export const ServerIcon = createLucideIcon({
  name: 'server',
  size: 24,
  node: [
    ['rect', { width: '20', height: '8', x: '2', y: '2', rx: '2', ry: '2', key: 'ngkwjq' }],
    ['rect', { width: '20', height: '8', x: '2', y: '14', rx: '2', ry: '2', key: 'iecqi9' }],
    ['line', { x1: '6', x2: '6.01', y1: '6', y2: '6', key: '16zg32' }],
    ['line', { x1: '6', x2: '6.01', y1: '18', y2: '18', key: 'nzw8ys' }],
  ],
});

export const StarIcon = createLucideIcon({
  name: 'star',
  size: 24,
  node: [
    [
      'path',
      {
        d: 'M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z',
        key: 'r04s7s',
      },
    ],
  ],
});

export const GitBranchIcon = createLucideIcon({
  name: 'git-branch',
  size: 24,
  node: [
    ['path', { d: 'M15 6a9 9 0 0 0-9 9V3', key: '1cii5b' }],
    ['circle', { cx: '18', cy: '6', r: '3', key: '1h7g24' }],
    ['circle', { cx: '6', cy: '18', r: '3', key: 'fqmcym' }],
  ],
});

export const DownloadIcon = createLucideIcon({
  name: 'download',
  size: 24,
  node: [
    ['path', { d: 'M12 15V3', key: 'm9g1x1' }],
    ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', key: 'ih7n3h' }],
    ['path', { d: 'm7 10 5 5 5-5', key: 'brsn70' }],
  ],
});
