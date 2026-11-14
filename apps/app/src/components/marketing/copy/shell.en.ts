import type { ShellCopy } from './types';

// Every link target below exists today.
export const shellEn: ShellCopy = {
  skipToContent: 'Skip to content',
  homeLabel: 'Nibleaf home',
  primaryNavLabel: 'Main navigation',
  nav: [
    { label: 'Features', href: '/#features' },
    { label: 'Use cases', href: '/#use-cases' },
    { label: 'Pricing', href: '/pricing' },
    { label: 'Docs', href: 'https://docs.nibleaf.com', external: true },
    { label: 'Self-hosting', href: '/self-hosting' },
  ],
  login: { label: 'Log in', href: '/sign-in' },
  start: { label: 'Start free', href: '/sign-up' },
  languageSwitch: { label: 'العربية', ariaLabel: 'Nibleaf بالعربية', hrefLang: 'ar' },
  theme: { darkMode: 'Dark mode', toDark: 'Switch to dark mode', toLight: 'Switch to light mode' },
  menu: { open: 'Open menu', close: 'Close menu', title: 'Menu' },
  github: {
    label: 'GitHub',
    starsLabel: (count) => (count === 1 ? '1 star on GitHub' : `${count.toLocaleString('en-US')} stars on GitHub`),
  },
  footer: {
    tagline: 'Open-source documentation and help center, with first-class Arabic.',
    openSource: {
      badge: 'Open source · AGPL-3.0',
      heading: 'Documentation you can own.',
      body: 'Read the code, run Nibleaf on your own servers, or start on the free cloud beta.',
    },
    columns: [
      {
        title: 'Product',
        links: [
          { label: 'Features', href: '/#features' },
          { label: 'Nibleaf Cloud', href: '/cloud' },
          { label: 'Pricing', href: '/pricing' },
          { label: 'Self-hosting', href: '/self-hosting' },
          { label: 'Releases', href: 'https://github.com/lord007tn/nibleaf/releases', external: true },
        ],
      },
      {
        title: 'Use cases',
        links: [
          { label: 'Support teams', href: '/use-cases/support-teams' },
          { label: 'Product teams', href: '/use-cases/product-docs' },
          { label: 'Developers', href: '/use-cases/api-docs' },
        ],
      },
      {
        title: 'Compare',
        links: [
          { label: 'vs Mintlify', href: '/compare/nibleaf-vs-mintlify' },
          { label: 'vs GitBook', href: '/compare/nibleaf-vs-gitbook' },
          { label: 'vs Docusaurus', href: '/compare/nibleaf-vs-docusaurus' },
          { label: 'Mintlify alternatives', href: '/alternatives/mintlify' },
          { label: 'GitBook alternatives', href: '/alternatives/gitbook' },
          { label: 'ReadMe alternatives', href: '/alternatives/readme' },
        ],
      },
      {
        title: 'Resources',
        links: [
          { label: 'Documentation', href: 'https://docs.nibleaf.com', external: true },
          { label: 'Blog', href: '/blog' },
          { label: 'Guides', href: '/guides' },
          { label: 'Developers', href: '/developers' },
          { label: 'RTL readiness checker', href: '/tools/rtl-documentation-readiness' },
        ],
      },
      {
        title: 'Company',
        links: [
          { label: 'About', href: '/about' },
          { label: 'Contact', href: '/contact' },
          { label: 'Terms', href: '/terms' },
          { label: 'Privacy', href: '/privacy' },
        ],
      },
    ],
    legalLine: (year) => `© ${year} Nibleaf. Built in the open under AGPL-3.0.`,
    licenseLabel: 'AGPL-3.0-only',
    sourceLabel: 'Source code',
  },
};
