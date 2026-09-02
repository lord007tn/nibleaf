import { json, type ThemeRepositoryTemplateOptions } from './types';

/** Public ecosystem packages only: the repository must install without the
 * Nibleaf monorepo (`workspace:` is forbidden) and build without network. */
export const packageJsonTemplate = ({ templateId }: ThemeRepositoryTemplateOptions): string =>
  json({
    name: `nibleaf-${templateId}-docs`,
    private: true,
    version: '0.1.0',
    type: 'module',
    engines: { node: '>=22.13.0', pnpm: '>=10.0.0' },
    packageManager: 'pnpm@10.30.3',
    scripts: {
      paraglide: 'paraglide-js compile --project ./project.inlang --outdir ./src/paraglide',
      dev: 'vite dev',
      build: 'pnpm paraglide && vite build',
      preview: 'vite preview',
      start: 'node .output/server/index.mjs',
      typecheck: 'pnpm paraglide && tsc --noEmit',
      test: 'pnpm paraglide && vitest run',
      check: 'pnpm paraglide && vitest run && vite build && tsc --noEmit',
    },
    dependencies: {
      '@tanstack/react-router': '^1.170.16',
      '@tanstack/react-start': '^1.168.26',
      'lucide-react': '^1.21.0',
      nitro: '3.0.260522-beta',
      react: '^19.2.7',
      'react-dom': '^19.2.7',
      'react-markdown': '^10.1.0',
      'rehype-raw': '^7.0.0',
      'rehype-sanitize': '^6.0.0',
      'remark-gfm': '^4.0.1',
    },
    devDependencies: {
      '@inlang/paraglide-js': '2.24.1',
      '@tailwindcss/vite': '^4.3.3',
      '@types/node': '^22.19.21',
      '@types/react': '^19.2.17',
      '@types/react-dom': '^19.2.3',
      '@vitejs/plugin-react': '^6.1.0',
      jsdom: '^30.0.1',
      'oxc-transform-react': '0.145.0',
      tailwindcss: '^4.3.3',
      typescript: '^7.0.2',
      vite: '^8.2.2',
      vitest: '^4.1.11',
    },
  });
