import type { Prisma } from '@nibleaf/database';
import { resolveLocale } from '@nibleaf/i18n/locales';
import {
  newsite_starter_faq_content,
  newsite_starter_faq_title,
  newsite_starter_firstguide_content,
  newsite_starter_firstguide_title,
  newsite_starter_gettingstarted_content,
  newsite_starter_gettingstarted_title,
  newsite_starter_guides_content,
  newsite_starter_guides_title,
  newsite_starter_welcome_content,
  newsite_starter_welcome_title,
} from '@nibleaf/i18n/messages';
import type { CreateProjectBody } from '@nibleaf/validators';

/** Draft pages share the new site's transaction, language and default branch. */
export async function createStarterPages(
  tx: Prisma.TransactionClient,
  projectId: string,
  branchId: string,
  languageId: string,
  code: string,
  starter: NonNullable<CreateProjectBody['starter']>,
) {
  const options = { locale: resolveLocale(code) ?? 'en' } as const;
  const welcome = {
    slug: 'welcome',
    title: newsite_starter_welcome_title(undefined, options),
    content: newsite_starter_welcome_content(undefined, options),
  };
  const gettingStarted = {
    slug: 'getting-started',
    title: newsite_starter_gettingstarted_title(undefined, options),
    content: newsite_starter_gettingstarted_content(undefined, options),
  };
  const guides = {
    slug: 'guides',
    title: newsite_starter_guides_title(undefined, options),
    content: newsite_starter_guides_content(undefined, options),
  };
  const firstGuide = {
    slug: 'first-guide',
    title: newsite_starter_firstguide_title(undefined, options),
    content: newsite_starter_firstguide_content(undefined, options),
  };
  const faq = { slug: 'faq', title: newsite_starter_faq_title(undefined, options), content: newsite_starter_faq_content(undefined, options) };
  const pages =
    starter === 'blank' ? [welcome] : starter === 'help-center' ? [welcome, gettingStarted, faq] : [welcome, gettingStarted, guides, firstGuide];
  let firstPageId = '';
  let guidesId: string | null = null;
  for (const [position, page] of pages.entries()) {
    const parentId: string | null = page === firstGuide ? guidesId : null;
    const created: { id: string } = await tx.page.create({
      data: {
        projectId,
        branchId,
        languageId,
        ...page,
        parentId,
        path: parentId ? `guides/${page.slug}` : page.slug,
        position: parentId ? 0 : position,
      },
      select: { id: true },
    });
    if (position === 0) firstPageId = created.id;
    if (page === guides) guidesId = created.id;
  }
  return firstPageId;
}
