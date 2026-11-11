import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { getData } from '@/hooks/api/client-helpers';
import type { ChangelogEntry, SitePage, SiteShell } from '@/hooks/api/types';
import { readerTextFor } from '@/lib/reader-text';
import { api } from '@/services/api';

const siteInput = z.object({
  projectId: z.string().min(1),
  language: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
});

const sitePageInput = siteInput.extend({ path: z.string() });

export const getSiteFn = createServerFn({ method: 'GET' })
  .validator(siteInput)
  .handler(async ({ data }) =>
    getData<SiteShell>(
      await api.public.sites[':id'].$get({
        param: { id: data.projectId },
        query: { ...(data.language ? { lang: data.language } : {}), ...(data.version ? { version: data.version } : {}) },
      }),
      'site',
    ),
  );

export const getSitePageFn = createServerFn({ method: 'GET' })
  .validator(sitePageInput)
  .handler(async ({ data }): Promise<SitePage> => {
    const page = await getData<SitePage>(
      await api.public.sites[':id'].page.$get({
        param: { id: data.projectId },
        query: {
          path: data.path,
          ...(data.language ? { lang: data.language } : {}),
          ...(data.version ? { version: data.version } : {}),
        },
      }),
      'page',
    );
    // Formatted here, on the server, for the reader's language (the requested
    // one, else the site's default), so hydration renders the same strings.
    const reader = data.language ?? page.languages.find((language) => language.isDefault)?.code ?? page.activeLanguage;
    return {
      ...page,
      readerText: readerTextFor(
        reader,
        page.page.updatedAt,
        page.languages.map((language) => language.code),
      ),
    };
  });

export const listSiteChangelogFn = createServerFn({ method: 'GET' })
  .validator(siteInput.pick({ projectId: true }))
  .handler(async ({ data }) =>
    getData<ChangelogEntry[]>(await api.public.sites[':id'].changelog.$get({ param: { id: data.projectId } }), 'changelog'),
  );

export const getGitPreviewFn = createServerFn({ method: 'GET' })
  .validator(z.object({ token: z.string().min(1) }))
  .handler(async ({ data }) => {
    const response = await api.public.git.previews[':token'].$get({ param: { token: data.token } });
    return JSON.stringify(await getData(response, 'pull-request preview'));
  });
