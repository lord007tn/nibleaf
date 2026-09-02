import { THEME_COLOR_KEYS, type ThemeColorTokens } from '../themes';
import type { ThemeRepositoryTemplateOptions } from './types';

const RADIUS: Record<string, string> = { sharp: '0', rounded: '0.5rem', pill: '0.9rem' };

const FONTS = {
  reference: {
    sans: "Inter, 'Noto Sans Arabic', ui-sans-serif, system-ui, sans-serif",
    heading: "Inter, 'Noto Sans Arabic', ui-sans-serif, system-ui, sans-serif",
  },
  editorial: {
    sans: "Inter, 'Noto Sans Arabic', ui-sans-serif, system-ui, sans-serif",
    heading: "Georgia, 'Noto Naskh Arabic', 'Times New Roman', serif",
  },
  console: {
    sans: "Inter, 'Noto Sans Arabic', ui-sans-serif, system-ui, sans-serif",
    heading: "Inter, 'Noto Sans Arabic', ui-sans-serif, system-ui, sans-serif",
  },
} as const;

const tokenLines = (colors: ThemeColorTokens): string => THEME_COLOR_KEYS.map((key) => `  --theme-${key}: ${colors[key]};`).join('\n');

/** Tailwind v4 entry: theme tokens from docs.json as CSS variables, exposed to
 * utilities through `@theme inline`, plus readable prose/component styles. */
export const stylesTemplate = ({ theme, displayName }: ThemeRepositoryTemplateOptions): string => {
  const fonts = FONTS[theme.layout.shell];
  return `@import "tailwindcss";

@custom-variant dark (&:where(.dark, .dark *));

/*
 * Theme tokens generated from docs.json → x-nibleaf.theme (${displayName} preset).
 * Nibleaf regenerates docs.json on every sync; this stylesheet is yours to edit.
 */
:root {
${tokenLines(theme.colors.light)}
  --theme-radius: ${RADIUS[theme.layout.radius] ?? '0.5rem'};
  --theme-font-sans: ${fonts.sans};
  --theme-font-heading: ${fonts.heading};
  --theme-font-mono: ui-monospace, 'JetBrains Mono', SFMono-Regular, Menlo, Consolas, monospace;
  color-scheme: light;
}

.dark {
${tokenLines(theme.colors.dark)}
  color-scheme: dark;
}

@theme inline {
  --color-canvas: var(--theme-canvas);
  --color-foreground: var(--theme-foreground);
  --color-surface: var(--theme-surface);
  --color-surface-raised: var(--theme-surfaceRaised);
  --color-muted: var(--theme-muted);
  --color-muted-foreground: var(--theme-mutedForeground);
  --color-border: var(--theme-border);
  --color-accent: var(--theme-accent);
  --color-accent-foreground: var(--theme-accentForeground);
  --color-focus: var(--theme-focus);
  --color-code: var(--theme-code);
  --color-code-foreground: var(--theme-codeForeground);
  --color-info: var(--theme-info);
  --color-success: var(--theme-success);
  --color-warning: var(--theme-warning);
  --color-danger: var(--theme-danger);
  --font-sans: var(--theme-font-sans);
  --font-heading: var(--theme-font-heading);
  --font-mono: var(--theme-font-mono);
  --radius-shell: var(--theme-radius);
}

@layer base {
  html {
    font-family: var(--font-sans);
    scroll-behavior: smooth;
    scroll-padding-block-start: 5rem;
  }

  body {
    background-color: var(--color-canvas);
    color: var(--color-foreground);
  }

  :focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }

  h1,
  h2,
  h3,
  h4 {
    font-family: var(--font-heading);
    text-wrap: balance;
  }
}

@layer components {
  .skip-link {
    position: absolute;
    inset-inline-start: 1rem;
    inset-block-start: -100%;
    z-index: 100;
    padding: 0.5rem 0.9rem;
    border-radius: var(--radius-shell);
    background-color: var(--color-accent);
    color: var(--color-accent-foreground);
  }

  .skip-link:focus {
    inset-block-start: 1rem;
  }

  .eyebrow {
    margin-block-end: 0.75rem;
    color: var(--color-muted-foreground);
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .lede {
    max-inline-size: 44rem;
    color: var(--color-muted-foreground);
    font-size: 1.15rem;
    line-height: 1.7;
  }

  .nav-link {
    display: block;
    padding: 0.45rem 0.7rem;
    border-radius: var(--radius-shell);
    color: var(--color-muted-foreground);
    text-decoration: none;
  }

  .nav-link:hover {
    background-color: var(--color-muted);
    color: var(--color-foreground);
  }

  .nav-link-active {
    background-color: color-mix(in srgb, var(--color-accent) 12%, transparent);
    color: var(--color-accent);
    font-weight: 600;
  }

  .segmented {
    display: inline-flex;
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-shell);
    background-color: var(--color-surface);
    font-size: 0.8rem;
  }

  .segmented a {
    padding: 0.35rem 0.7rem;
    color: var(--color-muted-foreground);
    text-decoration: none;
  }

  .segmented a + a {
    border-inline-start: 1px solid var(--color-border);
  }

  .segmented a[aria-current='true'] {
    background-color: var(--color-accent);
    color: var(--color-accent-foreground);
  }

  /* Article typography. Logical properties keep RTL pages mirrored correctly. */
  .prose {
    font-size: 1rem;
    line-height: 1.8;
  }

  .prose > * + * {
    margin-block-start: 1.1em;
  }

  .prose h2 {
    margin-block-start: 2.4em;
    font-size: 1.5rem;
    font-weight: 700;
    line-height: 1.3;
  }

  .prose h3 {
    margin-block-start: 1.8em;
    font-size: 1.2rem;
    font-weight: 650;
  }

  .prose h2 a,
  .prose h3 a {
    color: inherit;
    text-decoration: none;
  }

  .prose a {
    color: var(--color-accent);
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  .prose ul,
  .prose ol {
    padding-inline-start: 1.5rem;
  }

  .prose ul {
    list-style: disc;
  }

  .prose ol {
    list-style: decimal;
  }

  .prose li + li {
    margin-block-start: 0.35em;
  }

  .prose code {
    padding: 0.15em 0.35em;
    border-radius: 0.3rem;
    background-color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: 0.9em;
  }

  .prose pre {
    overflow-x: auto;
    padding: 1rem 1.2rem;
    border-radius: var(--radius-shell);
    background-color: var(--color-code);
    color: var(--color-code-foreground);
    direction: ltr;
    text-align: start;
  }

  .prose pre code {
    padding: 0;
    background: transparent;
    color: inherit;
    font-size: 0.875rem;
  }

  .prose blockquote {
    padding-inline-start: 1rem;
    border-inline-start: 3px solid var(--color-border);
    color: var(--color-muted-foreground);
  }

  .prose table {
    inline-size: 100%;
    border-collapse: collapse;
    font-size: 0.925rem;
  }

  .prose th,
  .prose td {
    padding: 0.5rem 0.75rem;
    border-block-end: 1px solid var(--color-border);
    text-align: start;
  }

  .prose th {
    background-color: var(--color-muted);
    font-weight: 600;
  }

  .prose img {
    max-inline-size: 100%;
    border-radius: var(--radius-shell);
  }

  .prose hr {
    border: 0;
    border-block-start: 1px solid var(--color-border);
  }

  /* Nibleaf MDX components (src/components/mdx). */
  .mdx-callout,
  .mdx-banner,
  .mdx-card,
  .mdx-accordion,
  .mdx-field,
  .mdx-update,
  .mdx-file-tree,
  .mdx-api-example,
  .mdx-related-card {
    display: block;
    margin-block: 1.25rem;
    padding: 1rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-shell);
    background-color: var(--color-surface);
  }

  .mdx-callout {
    display: flex;
    gap: 0.75rem;
    border-inline-start-width: 3px;
  }

  .mdx-callout-icon {
    flex: none;
    margin-block-start: 0.2rem;
  }

  .mdx-callout-body > :first-child {
    margin-block-start: 0;
  }

  .mdx-callout-body > :last-child {
    margin-block-end: 0;
  }

  .mdx-callout-info,
  .mdx-callout-note {
    border-inline-start-color: var(--color-info);
    color: inherit;
  }

  .mdx-callout-info .mdx-callout-icon,
  .mdx-callout-note .mdx-callout-icon {
    color: var(--color-info);
  }

  .mdx-callout-tip,
  .mdx-callout-check {
    border-inline-start-color: var(--color-success);
  }

  .mdx-callout-tip .mdx-callout-icon,
  .mdx-callout-check .mdx-callout-icon {
    color: var(--color-success);
  }

  .mdx-callout-warning {
    border-inline-start-color: var(--color-warning);
  }

  .mdx-callout-warning .mdx-callout-icon {
    color: var(--color-warning);
  }

  .mdx-callout-danger {
    border-inline-start-color: var(--color-danger);
  }

  .mdx-callout-danger .mdx-callout-icon {
    color: var(--color-danger);
  }

  .mdx-card-grid,
  .mdx-columns,
  .mdx-related-grid,
  .mdx-api-example > div {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
  }

  .mdx-card,
  .mdx-related-card {
    margin: 0;
    color: inherit;
    text-decoration: none;
  }

  a.mdx-card:hover,
  a.mdx-related-card:hover {
    border-color: var(--color-accent);
  }

  .mdx-card-title {
    display: block;
    margin-block-end: 0.35rem;
  }

  .mdx-related-card {
    display: grid;
    gap: 0.35rem;
  }

  .mdx-tabs {
    margin-block: 1.25rem;
  }

  .mdx-tabs [role='tablist'] {
    display: flex;
    gap: 0.35rem;
    overflow-x: auto;
    border-block-end: 1px solid var(--color-border);
  }

  .mdx-tabs [role='tab'] {
    padding: 0.6rem 0.8rem;
    border: 0;
    border-block-end: 2px solid transparent;
    background: transparent;
    color: var(--color-muted-foreground);
    cursor: pointer;
  }

  .mdx-tabs [aria-selected='true'] {
    border-block-end-color: var(--color-accent);
    color: var(--color-accent);
    font-weight: 600;
  }

  .mdx-tabs [role='tabpanel'] {
    padding-block: 1rem;
  }

  .mdx-accordion-group {
    border-block: 1px solid var(--color-border);
  }

  .mdx-accordion {
    margin: 0;
    padding: 0;
    border-width: 0 0 1px;
    border-radius: 0;
    background: transparent;
  }

  .mdx-accordion > button {
    display: flex;
    inline-size: 100%;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    font-weight: 600;
    text-align: start;
    cursor: pointer;
  }

  .mdx-accordion > div {
    padding-block-end: 1rem;
  }

  .mdx-steps {
    counter-reset: step;
    list-style: none;
    padding-inline-start: 2.2rem;
  }

  .mdx-steps > li {
    position: relative;
    margin-block: 1.25rem;
  }

  .mdx-steps > li::before {
    content: counter(list-item);
    position: absolute;
    inset-inline-start: -2.2rem;
    display: grid;
    inline-size: 1.5rem;
    block-size: 1.5rem;
    place-items: center;
    border-radius: 50%;
    background-color: var(--color-accent);
    color: var(--color-accent-foreground);
    font-size: 0.75rem;
    font-weight: 700;
  }

  .mdx-step-title {
    display: block;
    margin-block-end: 0.35rem;
  }

  .mdx-field {
    display: grid;
    grid-template-columns: max-content max-content 1fr;
    gap: 0.65rem;
    align-items: baseline;
  }

  .mdx-field-type {
    color: var(--color-muted-foreground);
    font-size: 0.8rem;
  }

  .mdx-file-tree {
    font-family: var(--font-mono);
    font-size: 0.875rem;
    list-style: none;
    direction: ltr;
    text-align: start;
  }

  .mdx-file-tree ul {
    padding-inline-start: 1.25rem;
    list-style: none;
  }

  .mdx-folder summary {
    cursor: pointer;
  }

  .mdx-file,
  .mdx-folder summary {
    padding-block: 0.2rem;
  }

  .mdx-code-group {
    overflow: hidden;
    margin-block: 1.25rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-shell);
  }

  .mdx-code-group pre {
    margin: 0;
    border-radius: 0;
  }

  .mdx-badge,
  .mdx-button {
    display: inline-flex;
    align-items: center;
    padding: 0.2rem 0.6rem;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    font-size: 0.8em;
    text-decoration: none;
  }

  .mdx-button {
    background-color: var(--color-accent);
    border-color: var(--color-accent);
    color: var(--color-accent-foreground);
    font-weight: 600;
  }

  .mdx-tooltip {
    position: relative;
    display: inline;
  }

  .mdx-tooltip-trigger {
    cursor: help;
    text-decoration: underline dotted;
    text-underline-offset: 0.18em;
  }

  .mdx-tooltip-content {
    position: absolute;
    z-index: 10;
    inset-block-end: calc(100% + 0.45rem);
    inset-inline-start: 50%;
    inline-size: max-content;
    max-inline-size: min(18rem, 80vw);
    transform: translateX(-50%);
    padding: 0.45rem 0.6rem;
    border-radius: 0.35rem;
    background-color: var(--color-code);
    color: var(--color-code-foreground);
    font-size: 0.75rem;
    line-height: 1.4;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
  }

  [dir='rtl'] .mdx-tooltip-content {
    transform: translateX(50%);
  }

  .mdx-tooltip:hover .mdx-tooltip-content,
  .mdx-tooltip:focus-within .mdx-tooltip-content {
    opacity: 1;
    visibility: visible;
  }

  .mdx-icon {
    display: inline-block;
    inline-size: 1em;
    block-size: 1em;
    vertical-align: -0.12em;
  }

  .mdx-frame {
    margin-block: 1.25rem;
  }

  .mdx-frame figcaption {
    margin-block-start: 0.5rem;
    color: var(--color-muted-foreground);
    font-size: 0.85rem;
    text-align: center;
  }

  @media (max-width: 700px) {
    .mdx-card-grid,
    .mdx-columns,
    .mdx-related-grid,
    .mdx-api-example > div,
    .mdx-field {
      grid-template-columns: 1fr;
    }
  }
}
`;
};
