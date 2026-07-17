#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

const [inputArg, outputArg, ghostUrlArg] = process.argv.slice(2);
if (!inputArg) {
  console.error('Usage: node scripts/split-ghost-by-language.mjs <ghost-export.json> [output-directory] [ghost-site-url]');
  process.exitCode = 1;
} else {
  const inputPath = resolve(inputArg);
  const outputDirectory = resolve(outputArg ?? 'output/ghost-migration');
  const ghostOrigin = ghostUrlArg ? new URL(ghostUrlArg).origin : undefined;
  const document = JSON.parse(await readFile(inputPath, 'utf8'));
  const database = Array.isArray(document.db) ? document.db[0] : undefined;
  const data = database?.data ?? document.data;
  if (!data || !Array.isArray(data.posts)) throw new Error('Not a Ghost export: expected db[0].data.posts.');

  const tagById = new Map(
    (Array.isArray(data.tags) ? data.tags : [])
      .filter((tag) => tag?.id && (tag.slug || tag.name))
      .map((tag) => [
        String(tag.id),
        String(tag.slug || tag.name)
          .trim()
          .toLowerCase(),
      ]),
  );
  const tagsByPostId = new Map();
  for (const relation of Array.isArray(data.posts_tags) ? data.posts_tags : []) {
    const tag = tagById.get(String(relation?.tag_id ?? ''));
    const postId = String(relation?.post_id ?? '');
    if (!(tag && postId)) continue;
    tagsByPostId.set(postId, [...(tagsByPostId.get(postId) ?? []), tag]);
  }

  const hasArabic = (post) => /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/u.test(`${post.title ?? ''}\n${post.plaintext ?? ''}\n${post.html ?? ''}`);
  const decisions = new Map();
  const counts = { en: 0, ar: 0, untagged: 0, ambiguous: 0 };
  for (const post of data.posts) {
    const tags = tagsByPostId.get(String(post.id ?? '')) ?? [];
    const languageTags = ['en', 'ar'].filter((code) => tags.includes(code));
    let language;
    if (languageTags.length === 1) language = languageTags[0];
    else if (languageTags.length > 1) {
      language = hasArabic(post) ? 'ar' : 'en';
      counts.ambiguous++;
    } else {
      language = hasArabic(post) ? 'ar' : 'en';
      counts.untagged++;
    }
    decisions.set(String(post.id ?? ''), language);
    counts[language]++;
  }

  await mkdir(outputDirectory, { recursive: true });
  const stem = basename(inputPath).replace(/\.json$/i, '');
  for (const language of ['en', 'ar']) {
    const postIds = new Set(data.posts.filter((post) => decisions.get(String(post.id ?? '')) === language).map((post) => String(post.id ?? '')));
    const localizedData = {
      ...data,
      posts: data.posts.filter((post) => postIds.has(String(post.id ?? ''))),
      ...(Array.isArray(data.pages) ? { pages: data.pages.filter((page) => decisions.get(String(page.id ?? '')) === language) } : {}),
      ...(Array.isArray(data.posts_tags) ? { posts_tags: data.posts_tags.filter((relation) => postIds.has(String(relation?.post_id ?? ''))) } : {}),
    };
    const localized = Array.isArray(document.db)
      ? { ...document, db: [{ ...database, data: localizedData }, ...document.db.slice(1)] }
      : { ...document, data: localizedData };
    const serialized = JSON.stringify(localized).replaceAll('__GHOST_URL__', ghostOrigin ?? '__GHOST_URL__');
    await writeFile(join(outputDirectory, `${stem}.${language}.json`), `${serialized}\n`);
  }

  const report = {
    source: inputPath,
    generatedAt: new Date().toISOString(),
    classification: counts,
    ghostOrigin: ghostOrigin ?? null,
    note: 'Exactly one en/ar Ghost tag wins. Items with both or neither tag are classified by Arabic script for this one-time migration.',
  };
  await writeFile(join(outputDirectory, `${stem}.report.json`), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
