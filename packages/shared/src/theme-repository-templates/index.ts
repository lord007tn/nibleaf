import {
  docsPageTemplate,
  mobileMenuTemplate,
  navTreeTemplate,
  notFoundTemplate,
  routeLinkTemplate,
  searchTemplate,
  switchersTemplate,
  themeToggleTemplate,
  tocTemplate,
} from './chrome';
import { harborLayoutTemplate, layoutIndexTemplate, layoutSharedTemplate, manuscriptLayoutTemplate, signalLayoutTemplate } from './layouts';
import { markdownTemplate, markdownTestTemplate } from './markdown';
import {
  mdxApiExampleTemplate,
  mdxCalloutsTemplate,
  mdxCardsTemplate,
  mdxDisclosureTemplate,
  mdxFieldsTemplate,
  mdxFileTreeTemplate,
  mdxIndexTemplate,
  mdxInlineTemplate,
  mdxSharedTemplate,
  mdxStepsTemplate,
  mdxTabsTemplate,
  mdxTooltipTemplate,
} from './mdx-components';
import { messagesTemplate } from './messages';
import { packageJsonTemplate } from './package-json';
import { readmeTemplate } from './readme';
import { indexRouteTemplate, rootRouteTemplate, routerTemplate, splatRouteTemplate } from './routes';
import { siteLibTemplate, siteLibTestTemplate } from './site-lib';
import { stylesTemplate } from './styles';
import {
  faviconTemplate,
  gitignoreTemplate,
  inlangSettingsTemplate,
  routeTreeTemplate,
  tsconfigTemplate,
  viteConfigTemplate,
  vitestConfigTemplate,
} from './tooling';
import type { ThemeRepositoryTemplateOptions } from './types';

export {
  THEME_REPOSITORY_TEMPLATE_META,
  type ThemeRepositoryTemplateOptions,
} from './types';

export interface ThemeRepositoryTemplateFile {
  path: string;
  content: string;
}

/** Every customer-owned file of the generated repository, in a stable order. */
export const themeRepositoryTemplateFiles = (options: ThemeRepositoryTemplateOptions): ThemeRepositoryTemplateFile[] => {
  const messages = messagesTemplate(options);
  return [
    { path: 'README.md', content: readmeTemplate(options) },
    { path: 'package.json', content: packageJsonTemplate(options) },
    { path: 'tsconfig.json', content: tsconfigTemplate() },
    { path: 'vite.config.ts', content: viteConfigTemplate() },
    { path: 'vitest.config.ts', content: vitestConfigTemplate() },
    { path: '.gitignore', content: gitignoreTemplate() },
    { path: 'project.inlang/settings.json', content: inlangSettingsTemplate() },
    { path: 'messages/en.json', content: messages.en },
    { path: 'messages/ar.json', content: messages.ar },
    { path: 'public/favicon.svg', content: faviconTemplate(options) },
    { path: 'src/router.tsx', content: routerTemplate() },
    { path: 'src/routeTree.gen.ts', content: routeTreeTemplate() },
    { path: 'src/styles.css', content: stylesTemplate(options) },
    { path: 'src/routes/__root.tsx', content: rootRouteTemplate() },
    { path: 'src/routes/index.tsx', content: indexRouteTemplate() },
    { path: 'src/routes/$.tsx', content: splatRouteTemplate() },
    { path: 'src/lib/site.ts', content: siteLibTemplate(options) },
    { path: 'src/lib/site.test.ts', content: siteLibTestTemplate() },
    { path: 'src/lib/markdown.tsx', content: markdownTemplate() },
    { path: 'src/lib/markdown.test.tsx', content: markdownTestTemplate() },
    { path: 'src/components/route-link.tsx', content: routeLinkTemplate() },
    { path: 'src/components/theme-toggle.tsx', content: themeToggleTemplate() },
    { path: 'src/components/search.tsx', content: searchTemplate() },
    { path: 'src/components/switchers.tsx', content: switchersTemplate() },
    { path: 'src/components/nav-tree.tsx', content: navTreeTemplate() },
    { path: 'src/components/toc.tsx', content: tocTemplate() },
    { path: 'src/components/mobile-menu.tsx', content: mobileMenuTemplate() },
    { path: 'src/components/not-found.tsx', content: notFoundTemplate() },
    { path: 'src/components/docs-page.tsx', content: docsPageTemplate() },
    { path: 'src/components/layout/shared.tsx', content: layoutSharedTemplate() },
    { path: 'src/components/layout/HarborLayout.tsx', content: harborLayoutTemplate() },
    { path: 'src/components/layout/ManuscriptLayout.tsx', content: manuscriptLayoutTemplate() },
    { path: 'src/components/layout/SignalLayout.tsx', content: signalLayoutTemplate() },
    { path: 'src/components/layout/index.tsx', content: layoutIndexTemplate() },
    { path: 'src/components/mdx/shared.ts', content: mdxSharedTemplate() },
    { path: 'src/components/mdx/callouts.tsx', content: mdxCalloutsTemplate() },
    { path: 'src/components/mdx/cards.tsx', content: mdxCardsTemplate() },
    { path: 'src/components/mdx/tabs.tsx', content: mdxTabsTemplate() },
    { path: 'src/components/mdx/disclosure.tsx', content: mdxDisclosureTemplate() },
    { path: 'src/components/mdx/steps.tsx', content: mdxStepsTemplate() },
    { path: 'src/components/mdx/fields.tsx', content: mdxFieldsTemplate() },
    { path: 'src/components/mdx/file-tree.tsx', content: mdxFileTreeTemplate() },
    { path: 'src/components/mdx/api-example.tsx', content: mdxApiExampleTemplate() },
    { path: 'src/components/mdx/tooltip.tsx', content: mdxTooltipTemplate() },
    { path: 'src/components/mdx/inline.tsx', content: mdxInlineTemplate() },
    { path: 'src/components/mdx/index.tsx', content: mdxIndexTemplate() },
  ];
};
