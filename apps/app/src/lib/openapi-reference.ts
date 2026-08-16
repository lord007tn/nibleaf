export const SCALAR_THEME = `
.scalar-app {
  --scalar-color-accent: var(--primary);
  --scalar-background-1: var(--background);
  --scalar-background-2: var(--muted);
  --scalar-background-3: var(--card);
  --scalar-color-1: var(--foreground);
  --scalar-color-2: var(--muted-foreground);
  --scalar-color-3: var(--muted-foreground);
  --scalar-border-color: var(--border);
  min-height: calc(100dvh - var(--site-header-h));
}
.scalar-app .references-layout { min-height: inherit; }
`;

export const scalarOpenApiConfiguration = (projectId: string) => ({
  url: `/api/public/sites/${encodeURIComponent(projectId)}/openapi.json`,
  layout: 'modern' as const,
  theme: 'none' as const,
  showSidebar: true,
  hideClientButton: false,
  hideDownloadButton: false,
  hideModels: false,
  persistAuth: false,
  withDefaultFonts: false,
  agent: { disabled: true },
  customCss: SCALAR_THEME,
});
