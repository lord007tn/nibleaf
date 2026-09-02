import type { ResolvedTheme, ThemePresetId } from '../themes';

interface ThemeRepositoryTemplateLanguage {
  code: string;
  label: string;
  direction: 'LTR' | 'RTL';
  isDefault: boolean;
}

/** Everything a template module needs to render one file of the generated
 * repository. Values are already validated/normalized by the generator. */
export interface ThemeRepositoryTemplateOptions {
  templateId: ThemePresetId;
  displayName: string;
  projectName: string;
  projectDescription: string | null;
  /** Content root relative to the repository root without slashes, e.g. `content`. Empty means the repository root. */
  contentRoot: string;
  languages: readonly ThemeRepositoryTemplateLanguage[];
  theme: ResolvedTheme;
  appearance: 'light' | 'dark' | 'system';
}

interface ThemeRepositoryTemplateMeta {
  componentName: 'HarborLayout' | 'ManuscriptLayout' | 'SignalLayout';
  displayName: 'Harbor' | 'Manuscript' | 'Signal';
  shell: ResolvedTheme['layout']['shell'];
}

export const THEME_REPOSITORY_TEMPLATE_META: Record<ThemePresetId, ThemeRepositoryTemplateMeta> = {
  harbor: { componentName: 'HarborLayout', displayName: 'Harbor', shell: 'reference' },
  manuscript: { componentName: 'ManuscriptLayout', displayName: 'Manuscript', shell: 'editorial' },
  signal: { componentName: 'SignalLayout', displayName: 'Signal', shell: 'console' },
};

export const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
