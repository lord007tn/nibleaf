import { ScrollArea } from '@nibleaf/design-system/components/ui/scroll-area';
import { cn } from '@nibleaf/design-system/lib/utils';
import { type ResolvedTheme, THEME_SCHEMA_VERSION, type ThemeLayout } from '@nibleaf/shared/themes';
import { type CSSProperties, createContext, type ReactNode, useContext } from 'react';

export type DocumentationThemeContextName = 'reader' | 'project-preview' | 'studio-preview';

interface ReaderSlots {
  banner?: ReactNode;
  header: ReactNode;
  navigation: ReactNode;
  content: ReactNode;
  footer?: ReactNode;
  overlays?: ReactNode;
}

interface ProjectPreviewSlots {
  mobileNavigation: ReactNode;
  navigation: ReactNode;
  content: ReactNode;
}

interface StudioPreviewSlots {
  header: ReactNode;
  navigation: ReactNode;
  content: ReactNode;
}

interface PageSlots {
  article: ReactNode;
  tableOfContents: ReactNode;
}

export interface DocumentationThemeTemplate {
  id: 'harbor' | 'manuscript' | 'signal';
  shell: ThemeLayout['shell'];
  ReaderLayout: (slots: ReaderSlots) => ReactNode;
  ProjectPreviewLayout: (slots: ProjectPreviewSlots) => ReactNode;
  StudioPreviewLayout: (slots: StudioPreviewSlots) => ReactNode;
  PageLayout: (slots: PageSlots) => ReactNode;
}

const readerFrame = (slots: ReaderSlots, body: ReactNode) => (
  <>
    {slots.banner}
    {slots.header}
    {body}
    {slots.footer}
    {slots.overlays}
  </>
);

/** Harbor — the classic three-column reference: persistent library sidebar,
 * reading column, page outline. Everything sits directly on the canvas. */
const HarborTemplate: DocumentationThemeTemplate = {
  id: 'harbor',
  shell: 'reference',
  ReaderLayout: (slots) =>
    readerFrame(
      slots,
      <div
        className="mx-auto grid w-full max-w-[90rem] flex-1 grid-cols-1 px-4 sm:px-6 lg:grid-cols-[16.5rem_minmax(0,1fr)] lg:gap-12"
        data-documentation-layout="harbor-reference"
        data-theme-region="content-shell"
      >
        <aside
          className="sticky top-(--site-header-h) hidden h-[calc(100dvh-var(--site-header-h))] self-start border-(--theme-border) border-e lg:block"
          data-theme-region="sidebar"
        >
          <ScrollArea className="h-full">
            <div className="pt-6 pb-16 pe-4" data-theme-region="sidebar-content">
              {slots.navigation}
            </div>
          </ScrollArea>
        </aside>
        {slots.content}
      </div>,
    ),
  ProjectPreviewLayout: ({ mobileNavigation, navigation, content }) => (
    <>
      {mobileNavigation}
      <div
        className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[280px_minmax(0,1fr)]"
        data-documentation-layout="harbor-reference-preview"
        data-theme-region="preview-shell"
      >
        <aside className="hidden min-h-0 flex-col border-border border-e bg-card/40 md:flex" data-theme-region="sidebar">
          {navigation}
        </aside>
        {content}
      </div>
    </>
  ),
  StudioPreviewLayout: ({ header, navigation, content }) => (
    <>
      {header}
      <div
        className="grid min-h-[22rem] grid-cols-[7.5rem_minmax(0,1fr)]"
        data-documentation-layout="harbor-reference-studio"
        data-theme-region="preview-shell"
      >
        <div className="border-border border-e bg-card/45 p-2 text-xs" data-theme-region="sidebar">
          {navigation}
        </div>
        {content}
      </div>
    </>
  ),
  PageLayout: ({ article, tableOfContents }) => (
    <div
      className="grid min-w-0 grid-cols-1 gap-12 py-9 lg:py-12 xl:grid-cols-[minmax(0,1fr)_13rem]"
      data-documentation-layout="harbor-reference-page"
      data-theme-region="page-shell"
    >
      {article}
      <aside className="hidden xl:block" data-theme-region="toc">
        {tableOfContents}
      </aside>
    </div>
  ),
};

/** Manuscript — an editorial shell: chapter deck across the top, then a single
 * sheet of "paper" carrying a focused reading measure with the outline in the
 * margin. */
const ManuscriptTemplate: DocumentationThemeTemplate = {
  id: 'manuscript',
  shell: 'editorial',
  ReaderLayout: (slots) => (
    <>
      {slots.banner}
      <section
        className="documentation-manuscript-reader flex flex-1 flex-col bg-(--theme-muted)/60"
        data-documentation-layout="manuscript-editorial"
      >
        {slots.header}
        <div className="mx-auto flex w-full max-w-[82rem] flex-1 flex-col px-4 pb-10 sm:px-6" data-theme-region="content-shell">
          <aside className="documentation-manuscript-reader-navigation hidden lg:block" data-theme-region="sidebar">
            <div className="documentation-manuscript-navigation py-6" data-theme-region="sidebar-content">
              {slots.navigation}
            </div>
          </aside>
          <div className="documentation-manuscript-paper min-w-0 flex-1 border border-(--theme-border) bg-(--theme-surface) shadow-[0_18px_50px_-20px_color-mix(in_oklab,var(--theme-foreground)_22%,transparent)] lg:mt-2">
            {slots.content}
          </div>
        </div>
      </section>
      {slots.footer}
      {slots.overlays}
    </>
  ),
  ProjectPreviewLayout: ({ mobileNavigation, navigation, content }) => (
    <>
      {mobileNavigation}
      <div
        className="flex min-h-0 flex-1 flex-col gap-3 bg-(--theme-muted)/55 p-3"
        data-documentation-layout="manuscript-editorial-preview"
        data-theme-region="preview-shell"
      >
        <aside
          className="documentation-manuscript-preview-navigation hidden max-h-40 flex-col border-border border-y bg-(--theme-canvas) md:flex"
          data-theme-region="sidebar"
        >
          {navigation}
        </aside>
        <div className="mx-auto min-h-0 w-full max-w-[60rem] flex-1 overflow-y-auto border border-border bg-(--theme-surface) shadow-lg">
          {content}
        </div>
      </div>
    </>
  ),
  StudioPreviewLayout: ({ header, navigation, content }) => (
    <div className="bg-(--theme-muted)/60 p-3" data-documentation-layout="manuscript-editorial-studio" data-theme-region="preview-shell">
      <div className="mx-auto max-w-[44rem] border border-border bg-(--theme-surface) shadow-lg">
        {header}
        <div className="documentation-manuscript-studio-navigation border-border border-y px-3 py-2 text-xs" data-theme-region="sidebar">
          {navigation}
        </div>
        <div className="min-h-[20rem]">{content}</div>
      </div>
    </div>
  ),
  PageLayout: ({ article, tableOfContents }) => (
    <div
      className="grid min-w-0 justify-center gap-10 px-5 py-10 sm:px-8 lg:py-14 xl:grid-cols-[11rem_minmax(0,44rem)] xl:gap-14"
      data-documentation-layout="manuscript-editorial-page"
      data-theme-region="page-shell"
    >
      <aside className="hidden xl:block" data-theme-region="toc">
        {tableOfContents}
      </aside>
      {article}
    </div>
  ),
};

/** Signal — a console: a dark library rail, a wide canvas, and an inline
 * command index above each article. Sharp corners, compact density. */
const SignalTemplate: DocumentationThemeTemplate = {
  id: 'signal',
  shell: 'console',
  ReaderLayout: (slots) => (
    <>
      {slots.banner}
      <section className="documentation-signal-reader flex flex-1 flex-col p-0 lg:p-3" data-documentation-layout="signal-console">
        {slots.header}
        <div
          className="mx-auto grid w-full max-w-[100rem] flex-1 grid-cols-1 bg-(--theme-canvas) lg:grid-cols-[15rem_minmax(0,1fr)] lg:overflow-hidden lg:border lg:border-(--theme-border) lg:border-t-0"
          data-theme-region="content-shell"
        >
          <aside
            className="documentation-signal-rail hidden min-h-0 border-(--theme-border) border-e bg-(--theme-code) text-(--theme-code-foreground) lg:block"
            data-theme-region="sidebar"
          >
            <ScrollArea className="sticky top-[4.25rem] h-[calc(100dvh-5.75rem)]">
              <div className="px-3 pt-4 pb-16" data-theme-region="sidebar-content">
                {slots.navigation}
              </div>
            </ScrollArea>
          </aside>
          <div className="min-w-0">{slots.content}</div>
        </div>
      </section>
      {slots.footer}
      {slots.overlays}
    </>
  ),
  ProjectPreviewLayout: ({ mobileNavigation, navigation, content }) => (
    <>
      {mobileNavigation}
      <div
        className="grid min-h-0 flex-1 grid-cols-1 gap-2 bg-(--theme-code) p-2 md:grid-cols-[13rem_minmax(0,1fr)]"
        data-documentation-layout="signal-console-preview"
        data-theme-region="preview-shell"
      >
        <aside
          className="documentation-signal-rail hidden min-h-0 flex-col border border-border bg-(--theme-code) text-(--theme-code-foreground) md:flex"
          data-theme-region="sidebar"
        >
          {navigation}
        </aside>
        <div className="min-h-0 overflow-y-auto border border-border bg-(--theme-canvas)">{content}</div>
      </div>
    </>
  ),
  StudioPreviewLayout: ({ header, navigation, content }) => (
    <div className="bg-(--theme-code) p-2" data-documentation-layout="signal-console-studio" data-theme-region="preview-shell">
      {header}
      <div className="grid min-h-[22rem] grid-cols-[6.5rem_minmax(0,1fr)] border border-border border-t-0 bg-(--theme-canvas)">
        <div
          className="documentation-signal-rail border-border border-e bg-(--theme-code) p-2 text-(--theme-code-foreground) text-xs"
          data-theme-region="sidebar"
        >
          {navigation}
        </div>
        {content}
      </div>
    </div>
  ),
  PageLayout: ({ article, tableOfContents }) => (
    <div
      className="flex min-w-0 flex-col gap-5 px-4 py-6 sm:px-6 lg:p-8"
      data-documentation-layout="signal-console-page"
      data-theme-region="page-shell"
    >
      <aside
        className="documentation-signal-command-index hidden border border-(--theme-border) bg-(--theme-surface) px-4 py-2.5 xl:block"
        data-theme-region="toc"
      >
        {tableOfContents}
      </aside>
      <div className="documentation-signal-article min-w-0 lg:border lg:border-(--theme-border) lg:bg-(--theme-surface) lg:px-10 lg:py-9">
        {article}
      </div>
    </div>
  ),
};

export const DOCUMENTATION_THEME_TEMPLATES = {
  reference: HarborTemplate,
  editorial: ManuscriptTemplate,
  console: SignalTemplate,
} as const satisfies Record<ThemeLayout['shell'], DocumentationThemeTemplate>;

const DocumentationTemplateContext = createContext<ThemeLayout['shell']>('reference');

export function DocumentationThemeProvider({
  theme,
  context,
  direction,
  appearance,
  className,
  style,
  css,
  children,
}: {
  theme: ResolvedTheme;
  context: DocumentationThemeContextName;
  direction: 'ltr' | 'rtl';
  appearance?: 'light' | 'dark';
  className?: string;
  style?: CSSProperties;
  css?: string;
  children: ReactNode;
}) {
  const template = DOCUMENTATION_THEME_TEMPLATES[theme.layout.shell];
  return (
    <DocumentationTemplateContext.Provider value={theme.layout.shell}>
      <div
        className={cn('nibleaf-site-chrome', className, appearance === 'dark' && 'dark')}
        data-documentation-template={template.id}
        data-theme-callouts={theme.components.callouts}
        data-theme-context={context}
        data-theme-cards={theme.components.cards}
        data-theme-code={theme.components.codeBlocks}
        data-theme-density={theme.layout.density}
        data-theme-header={theme.layout.header}
        data-theme-id={theme.id}
        data-theme-navigation={theme.layout.navigation}
        data-theme-radius={theme.layout.radius}
        data-theme-schema={THEME_SCHEMA_VERSION}
        data-theme-shell={theme.layout.shell}
        data-theme-sidebar={theme.layout.sidebar}
        data-theme-tables={theme.components.tables}
        data-theme-tabs={theme.components.tabs}
        data-theme-width={theme.layout.contentWidth}
        dir={direction}
        style={style}
      >
        {css ? (
          // biome-ignore lint/security/noDangerouslySetInnerHtml: callers provide schema-validated, enum-derived theme CSS.
          <style dangerouslySetInnerHTML={{ __html: css }} />
        ) : null}
        {children}
      </div>
    </DocumentationTemplateContext.Provider>
  );
}

const useDocumentationThemeTemplate = (): DocumentationThemeTemplate => DOCUMENTATION_THEME_TEMPLATES[useContext(DocumentationTemplateContext)];

export function DocumentationReaderLayout(slots: ReaderSlots) {
  return useDocumentationThemeTemplate().ReaderLayout(slots);
}

export function DocumentationProjectPreviewLayout(slots: ProjectPreviewSlots) {
  return useDocumentationThemeTemplate().ProjectPreviewLayout(slots);
}

export function DocumentationStudioPreviewLayout(slots: StudioPreviewSlots) {
  return useDocumentationThemeTemplate().StudioPreviewLayout(slots);
}

export function DocumentationPageLayout(slots: PageSlots) {
  return useDocumentationThemeTemplate().PageLayout(slots);
}
