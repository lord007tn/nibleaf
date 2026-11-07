---
title: 'Redirect old page addresses'
description: 'Send readers from an old page address to its new location, learn which redirects are allowed, and publish them without risking your live site.'
audience: 'site admins planning URL changes'
content_type: 'reference'
last_reviewed: '2026-11-07'
verified_against: 'apps/app/src/components/project-settings/redirects-section.tsx, apps/app/src/components/project/publish-modal.tsx, packages/shared/src/redirects.ts, packages/validators/src/redirects.ts, and apps/server/src/actions/deployments.ts'
lang: 'en'
dir: 'ltr'
translation_key: 'redirects'
---

A redirect sends readers from an old address to a new one, so saved links and
search results keep working after you move or rename a page. Redirects take
effect when you publish.

## Add a redirect

You need to be the site's Owner or an Admin.

1. Open **Settings → Appearance → Redirects**. In the editor, you can also select
   **Settings**, then **Redirects**.
2. Select **Add redirect**.
3. In **Redirect from path**, enter the old address on your site, such as
   `/old-guide`.
4. In **Redirect to path**, enter the new address on your site, such as
   `/guides/setup`, or a full web address starting with `https://`.
5. Save, then [publish](/product/publishing).

If a rule has a problem, Nibleaf shows **Fix these redirect rules before saving**
and highlights the rows involved.

## Rules for the old address

- Use only the part of the address after your domain, such as `/old-guide`.
  Don't include your domain, a `?` query, or a `#` section.
- Slashes at the start and end don't matter: `/old-guide/` and `/old-guide` are
  the same rule.
- Each old address can appear only once. It can't point to itself, and it can't
  be the address of a page that still exists.

## Rules for the new address

- **On your site:** a path such as `/guide`. It may include a query and a section,
  such as `/guide?lang=ar#install`. The page must exist, be published, and not be
  hidden.
- **Another website:** a full address starting with `https://` or `http://`. It
  can't include a user name or password.
- To send readers to a page in a specific language, add `?lang=` with a language
  your site serves, such as `?lang=ar`. Without it, readers stay in the language
  they were reading.

## Limits and chains

- A site can have up to 100 redirects.
- A redirect can point to another redirect, up to 10 steps, but never in a loop.
- When you publish, Nibleaf shortens every chain so readers jump straight to the
  final page in one step.
- Redirects use the permanent HTTP status `308`, which tells search engines the
  page has moved for good.

## When a redirect blocks publishing

Nibleaf checks redirects when you save, again in the publish dialog, and again
while it builds the new version. If a redirect points to a page that is missing,
hidden, or in a language your site doesn't serve, the publish dialog shows
**Redirects must be fixed before publishing** and nothing goes live. Your current
site stays as it is. Fix the rule, save, and publish again.
