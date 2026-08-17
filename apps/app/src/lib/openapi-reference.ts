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
  --scalar-link-color: var(--foreground);
  --scalar-link-color-hover: var(--primary);
  --scalar-sidebar-background-1: var(--background);
  --scalar-sidebar-color-1: var(--foreground);
  --scalar-sidebar-color-2: var(--muted-foreground);
  --scalar-sidebar-border-color: var(--border);
  --scalar-sidebar-item-hover-background: var(--muted);
  --scalar-sidebar-item-hover-color: var(--foreground);
  --scalar-sidebar-item-active-background: var(--muted);
  --scalar-sidebar-color-active: var(--foreground);
  --scalar-sidebar-search-background: var(--muted);
  --scalar-sidebar-search-color: var(--foreground);
  --scalar-sidebar-search-border-color: var(--border);
  --scalar-button-1: var(--foreground);
  --scalar-button-1-hover: var(--foreground);
  --scalar-button-1-color: var(--background);
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
  telemetry: false,
  withDefaultFonts: false,
  agent: { disabled: true },
  mcp: { disabled: true },
  showDeveloperTools: 'never' as const,
  customCss: SCALAR_THEME,
});
