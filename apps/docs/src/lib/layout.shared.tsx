import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: { title: 'Plume' },
    links: [
      { text: 'Documentation', url: '/docs', active: 'nested-url' },
      { text: 'Dashboard', url: 'http://localhost:4310' },
    ],
  };
}
