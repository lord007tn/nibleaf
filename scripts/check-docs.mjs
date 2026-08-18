import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, normalize, relative, resolve, sep } from 'node:path';

const root = process.cwd();
const docsRoot = join(root, 'docs');
const configPath = join(docsRoot, 'docs.json');
const nonPublishedRoots = [join(docsRoot, 'marketing')];
const nonPublishedFiles = new Set([join(docsRoot, 'README.md'), join(docsRoot, 'ARABIC_GLOSSARY.md')].map(normalize));
const errors = [];
const REQUIRED_LANGUAGES = ['en', 'ar'];
const ARABIC = /[\u0600-\u06ff]/u;

const fail = (file, message) => errors.push(`${relative(root, file)}: ${message}`);
const sourceFor = (page) => {
  for (const extension of ['.mdx', '.md']) {
    const candidate = join(docsRoot, `${page}${extension}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
};
if (!existsSync(configPath)) {
  fail(configPath, 'missing documentation navigation');
} else {
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    fail(configPath, `invalid JSON (${error.message})`);
  }

  if (config) validateConfig(config);
}

if (errors.length) {
  console.error(`Documentation checks failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('Documentation language trees, pairing, metadata, headings, media, code, and local links are valid.');
}

function validateConfig(config) {
  const languageEntries = config.navigation?.languages;
  if (!Array.isArray(languageEntries)) {
    fail(configPath, 'navigation.languages must define the English and Arabic trees');
    return;
  }
  const codes = languageEntries.map((entry) => entry?.language).filter(Boolean);
  if (codes.length !== REQUIRED_LANGUAGES.length || REQUIRED_LANGUAGES.some((code) => !codes.includes(code))) {
    fail(configPath, `navigation must define exactly ${REQUIRED_LANGUAGES.join(' and ')} (found ${codes.join(', ') || 'none'})`);
  }
  if (
    languageEntries.filter((entry) => entry?.default === true).length !== 1 ||
    languageEntries.find((entry) => entry?.default === true)?.language !== 'en'
  ) {
    fail(configPath, 'English must be the one explicit default language');
  }

  const trees = new Map();
  const allRoutes = new Set();
  for (const entry of languageEntries) {
    if (!entry || typeof entry !== 'object' || typeof entry.language !== 'string') continue;
    const tree = collectLanguageTree(entry);
    trees.set(entry.language, tree);
    for (const route of tree.pages) {
      if (allRoutes.has(route)) fail(configPath, `navigation route "${route}" is listed in more than one language`);
      allRoutes.add(route);
    }
  }

  const records = new Map();
  const navigatedFiles = new Set();
  for (const [language, tree] of trees) {
    const duplicates = tree.pages.filter((page, index) => tree.pages.indexOf(page) !== index);
    for (const page of new Set(duplicates)) fail(configPath, `${language} navigation lists "${page}" more than once`);
    for (const route of tree.pages) {
      if (route === 'marketing' || route.startsWith('marketing/')) {
        fail(configPath, `internal strategy route "${route}" must never be public`);
        continue;
      }
      const file = sourceFor(route);
      if (!file) {
        fail(configPath, `${language} navigation page "${route}" has no .md or .mdx source`);
        continue;
      }
      navigatedFiles.add(normalize(file));
      const record = checkPage(file, route, language, allRoutes);
      if (!record) continue;
      const pair = records.get(record.translationKey) ?? new Map();
      if (pair.has(language)) fail(file, `translation_key "${record.translationKey}" is duplicated in ${language}`);
      pair.set(language, record);
      records.set(record.translationKey, pair);
    }
  }

  for (const file of markdownFiles(docsRoot)) {
    const normalized = normalize(file);
    if (nonPublishedFiles.has(normalized)) continue;
    if (nonPublishedRoots.some((directory) => normalized.startsWith(`${normalize(directory)}${sep}`))) continue;
    if (!navigatedFiles.has(normalized)) fail(file, 'page is orphaned from docs.json navigation');
  }

  validateTreeParity(trees);
  for (const [translationKey, pair] of records) {
    for (const language of REQUIRED_LANGUAGES) {
      if (!pair.has(language)) fail(configPath, `translation_key "${translationKey}" is missing its ${language} page`);
    }
    const english = pair.get('en');
    const arabic = pair.get('ar');
    if (!english || !arabic) continue;
    if (english.contentType !== arabic.contentType) {
      fail(arabic.file, `content_type must match ${relative(root, english.file)} for pair "${translationKey}"`);
    }
    if (english.fences.length !== arabic.fences.length || english.fences.some((fence, index) => fence !== arabic.fences[index])) {
      fail(arabic.file, `fenced code must match the English source exactly for pair "${translationKey}"`);
    }
  }

  const pageCount = [...trees.values()].reduce((sum, tree) => sum + tree.pages.length, 0);
  if (pageCount !== 40 || records.size !== 20) {
    fail(configPath, `expected 20 explicit English/Arabic page pairs (found ${records.size} pairs across ${pageCount} routes)`);
  }
  console.log(`Checked ${records.size} English/Arabic documentation pairs across ${pageCount} navigated pages.`);
}

function collectLanguageTree(entry) {
  const pages = [];
  const groups = [];
  const visit = (value, path = []) => {
    if (typeof value === 'string') {
      pages.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => {
        visit(item, path);
      });
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (typeof value.page === 'string') pages.push(value.page);
    if (typeof value.group === 'string') {
      const slug = value['x-nibleaf']?.slug;
      if (typeof slug !== 'string' || !slug.trim())
        fail(configPath, `${entry.language} group "${value.group}" needs x-nibleaf.slug for stable localized routes`);
      groups.push({ path: [...path, slug].join('/'), slug, label: value.group });
      for (const key of ['groups', 'pages', 'tabs', 'anchors', 'dropdowns']) visit(value[key], [...path, slug]);
      return;
    }
    for (const key of ['groups', 'pages', 'tabs', 'anchors', 'dropdowns']) visit(value[key], path);
  };
  visit(entry);
  if (entry.language === 'ar') {
    if (entry['x-nibleaf']?.config?.search?.placeholder !== 'ابحث في التوثيق')
      fail(configPath, 'Arabic navigation needs a localized search placeholder');
    if (!ARABIC.test(entry['x-nibleaf']?.config?.seo?.metaTitle ?? '')) fail(configPath, 'Arabic navigation needs Arabic SEO metadata');
  }
  return { pages, groups };
}

function validateTreeParity(trees) {
  const english = trees.get('en');
  const arabic = trees.get('ar');
  if (!english || !arabic) return;
  const englishGroups = english.groups.map((group) => group.path);
  const arabicGroups = arabic.groups.map((group) => group.path);
  if (JSON.stringify(englishGroups) !== JSON.stringify(arabicGroups)) fail(configPath, 'English and Arabic group slug/order parity differs');
  if (english.groups.some((group) => ARABIC.test(group.label))) fail(configPath, 'English navigation group labels must be English');
  if (arabic.groups.some((group) => !ARABIC.test(group.label))) fail(configPath, 'Arabic navigation group labels must be Arabic');
  const englishKeys = english.pages;
  const arabicKeys = arabic.pages.map((route) => route.replace(/^ar\//, ''));
  if (JSON.stringify(englishKeys) !== JSON.stringify(arabicKeys)) fail(configPath, 'English and Arabic routes/order must have exact parity');
}

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return ['.md', '.mdx'].includes(extname(entry.name)) ? [path] : [];
  });
}

function checkPage(file, route, expectedLanguage, routes) {
  const source = readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
  const frontmatter = source.match(/^---\n([\s\S]*?)\n---\n/);
  if (!frontmatter) {
    fail(file, 'missing YAML frontmatter');
    return null;
  }
  const metadata = Object.fromEntries(
    frontmatter[1]
      .split('\n')
      .map((line) => line.match(/^([a-z_]+):\s*(.+)$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2].replace(/^['"]|['"]$/g, '')]),
  );
  for (const key of ['title', 'description', 'audience', 'content_type', 'last_reviewed', 'verified_against', 'lang', 'dir', 'translation_key']) {
    if (!metadata[key]) fail(file, `missing ${key} frontmatter`);
  }
  if (metadata.lang !== expectedLanguage) fail(file, `lang must be "${expectedLanguage}" for route "${route}"`);
  const expectedDirection = expectedLanguage === 'ar' ? 'rtl' : 'ltr';
  if (metadata.dir !== expectedDirection) fail(file, `dir must be "${expectedDirection}"`);
  const expectedKey = expectedLanguage === 'ar' ? route.replace(/^ar\//, '') : route;
  if (metadata.translation_key !== expectedKey) fail(file, `translation_key must be "${expectedKey}"`);
  if (metadata.description && (metadata.description.length < 70 || metadata.description.length > 180)) {
    fail(file, `description must be 70-180 characters (found ${metadata.description.length})`);
  }
  if (!['tutorial', 'how-to', 'reference', 'explanation'].includes(metadata.content_type)) {
    fail(file, 'content_type must follow the tutorial/how-to/reference/explanation model');
  }
  if (expectedLanguage === 'ar') {
    for (const key of ['title', 'description', 'audience']) {
      if (!ARABIC.test(metadata[key] ?? '')) fail(file, `${key} must contain Arabic text`);
    }
  }

  const body = source.slice(frontmatter[0].length);
  const withoutFences = body.replace(/```[\s\S]*?```/g, '');
  let previousLevel = 1;
  for (const match of withoutFences.matchAll(/^(#{2,6})\s+(.+)$/gm)) {
    const level = match[1].length;
    if (level > previousLevel + 1) fail(file, `heading "${match[2]}" skips from H${previousLevel} to H${level}`);
    previousLevel = level;
  }

  for (const match of body.matchAll(/(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const [, imageMarker, label, target] = match;
    if (expectedLanguage === 'ar' && imageMarker === '!' && !ARABIC.test(label)) fail(file, `image "${target}" needs Arabic alt text`);
    if (/^(?:https?:|mailto:|#)/.test(target)) continue;
    const clean = target.split('#')[0].split('?')[0];
    if (!clean) continue;
    if (target.startsWith('/')) {
      const routeTarget = clean.replace(/^\/+|\/$/g, '');
      if (!routes.has(routeTarget)) fail(file, `local route "${clean}" is absent from docs.json navigation`);
      if (routes.has(routeTarget) && expectedLanguage === 'ar' && !routeTarget.startsWith('ar/'))
        fail(file, `Arabic page links to the English route "${clean}"`);
      if (routes.has(routeTarget) && expectedLanguage === 'en' && routeTarget.startsWith('ar/'))
        fail(file, `English page links to the Arabic route "${clean}"`);
      continue;
    }
    const resolved = resolve(dirname(file), clean);
    if (!resolved.startsWith(`${docsRoot}${sep}`) && resolved !== docsRoot) fail(file, `local link escapes the docs directory: "${clean}"`);
    else if (!existsSync(resolved)) fail(file, `local link target does not exist: "${clean}"`);
  }
  if (expectedLanguage === 'ar') {
    for (const match of body.matchAll(/<Frame\s+[^>]*caption=["']([^"']+)["'][^>]*>/g)) {
      if (!ARABIC.test(match[1])) fail(file, 'Frame captions on Arabic pages must be Arabic');
    }
    if ((body.match(/[\u0600-\u06ff]/gu) ?? []).length < 100) fail(file, 'Arabic page body is too short to be a substantive adaptation');
  }
  if (!body.match(/^##\s+/m)) fail(file, `route "${route}" needs at least one H2 section`);

  return {
    file,
    route,
    translationKey: metadata.translation_key,
    contentType: metadata.content_type,
    fences: [...body.matchAll(/```[^\n]*\n[\s\S]*?```/g)].map((match) => match[0]),
  };
}
