---
title: 'Connect a GitHub repository'
description: 'Connect GitHub so browser edits become a draft pull request, repository changes flow back into Nibleaf, and conflicts are never overwritten silently.'
audience: 'site admins and documentation teams using GitHub'
content_type: 'how-to'
last_reviewed: '2026-11-07'
verified_against: 'apps/app/src/components/settings/git-tab.tsx and git-workflow.tsx, apps/server/src/actions/git, apps/worker/src/processors/git.ts, packages/shared/src/theme-repository.ts, and packages/i18n/messages'
lang: 'en'
dir: 'ltr'
translation_key: 'git-authoring'
---

If your team keeps documentation in GitHub, you can connect a repository so
people can edit in Nibleaf or in Git. Nibleaf sends browser edits to GitHub as a
draft pull request for review, brings repository changes back into Nibleaf, and
stops to ask you when both sides changed the same file.

To copy Markdown from a public repository once, without two-way editing, use
**Import a public repository instead** on the same screen, or see
[Move your docs to Nibleaf](/product/migration).

## Before you start

- You need to be the site's Owner or an Admin. The Git settings are not shown to
  Editors.
- You need a GitHub repository and permission to create a token for it.
- On a self-hosted instance, an operator must set the Git encryption and worker
  secrets first; see [Configure a production deployment](/self-hosting/configuration).
- Practice with a test repository before you connect your main one.

## Create a GitHub token

A token is a password that lets Nibleaf act on one repository. In GitHub, create
a **fine-grained personal access token** limited to the repository you want to
connect, with only these permissions:

- **Metadata:** read
- **Contents:** read and write
- **Pull requests:** read and write

Nibleaf doesn't need any other permission. It encrypts the token, never shows it
again, and never writes it to logs.

## Connect the repository

1. Open **Settings → Git**. Under **Two-way Git workflow**, select
   **Connect GitHub**.
2. **Authorize:** paste the token into **Fine-grained token** and select
   **Authorize GitHub**.
3. **Repository:** choose the repository and:
   - the **Base branch** your docs come from, usually `main`;
   - a separate **Dedicated Nibleaf branch**, for example `nibleaf/docs`, where
     Nibleaf writes its changes;
   - the **Docs path**, the folder that holds your docs (`content` by default).
4. **Review:** check the account, source, and destination, then select
   **Connect GitHub**.

Connecting does not copy anything yet. Importing and sending changes are
separate steps.

## Bring repository changes into Nibleaf

Open **Import and sync** and select **Sync latest changes**. Nibleaf reads the
base branch, compares it with the last version both sides agreed on, and updates
your pages. Imported changes are drafts until you publish.

To sync automatically after every push, add a webhook in GitHub. Open
**Connection settings** in Nibleaf to copy the payload URL and secret. In GitHub,
open the repository's **Settings → Webhooks → Add webhook**, paste both values,
set the content type to `application/json`, and subscribe to **Pushes** and
**Pull requests**.

## Send Nibleaf edits to GitHub

1. Open **Create or update PR**.
2. Check the changed files, and fill in the **Commit message**, **Author name**,
   **Author email**, and **Pull request title**.
3. Select the commit button, such as **Commit and update draft PR**.

Nibleaf commits to the dedicated branch and creates or updates one draft pull
request. It never force-pushes. If the branch changed on GitHub in the meantime,
Nibleaf stops so you can sync first.

Each pull request gets its own preview, a private, unlisted copy of the docs that
search engines don't index. You can follow it in **Pull requests and previews**.
Closing the pull request retires its preview.

## Resolve conflicts

When a file changed both in Nibleaf and in Git, Nibleaf marks it as a
**Conflict** and changes nothing until you decide. In **Reconcile conflicts** you
see three versions of each file: the **Base** both sides started from, the
Nibleaf version, and the Git version. For each file, choose **Use Nibleaf**,
**Use Git**, **Use custom** to write your own version, or **Delete file**.

When every file has a decision, Nibleaf continues. If only one side changed a
file, Nibleaf keeps that change automatically.

## How files are laid out in the repository

Inside the docs path, Nibleaf uses this layout:

```text
content/
  guides/authentication.mdx        default language
  ar/guides/authentication.mdx     other languages, by language code
  versions/v1/guides/...           other documentation versions
```

Folders become navigation groups, and an `index.mdx` file is a folder's landing
page. Arabic file names stay readable. Nibleaf creates `docs.json` and the
`.nibleaf/` folder itself and rewrites them on every sync, so don't edit them by
hand.

## Troubleshoot

- **The panel says authorization failed:** the token expired or is missing a
  permission. Create a new token with the permissions above and connect again.
- **The remote branch changed:** select **Sync latest changes**, resolve any
  conflicts, then send your changes again.
- **A sync or pull request seems stuck:** check **Status and activity**. On a
  self-hosted instance, ask your operator to check that the Git worker is
  running; see [Troubleshooting](/self-hosting/troubleshooting).
- **The webhook secret was lost:** rotate it in **Connection settings**, update it
  in GitHub straight away, and redeliver missed events from GitHub.

To stop syncing, open **Connection settings** and select **Disconnect**. This
removes the stored token and sync history, but keeps your pages and your
repository as they are.
