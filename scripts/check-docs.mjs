import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, normalize, relative, resolve, sep } from 'node:path';

const root = process.cwd();
const docsRoot = join(root, 'docs');
const configPath = join(docsRoot, 'docs.json');
// Repository planning material lives beside the importable docs source, but it
// is intentionally not reader-facing and must not be forced into docs.json.
const nonPublishedRoots = [join(docsRoot, 'marketing')];
const errors = [];

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

  if (config) {
    const pages = [];
    const visit = (value) => {
      if (typeof value === 'string') pages.push(value);
      else if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') {
        if (typeof value.page === 'string') pages.push(value.page);
        for (const key of ['groups', 'pages', 'tabs', 'anchors', 'dropdowns']) visit(value[key]);
      }
    };
    visit(config.navigation);

    const duplicates = pages.filter((page, index) => pages.indexOf(page) !== index);
    for (const page of new Set(duplicates)) fail(configPath, `navigation lists "${page}" more than once`);

    const navigatedFiles = new Set();
    for (const page of pages) {
      const file = sourceFor(page);
      if (!file) {
        fail(configPath, `navigation page "${page}" has no .md or .mdx source`);
        continue;
      }
      navigatedFiles.add(normalize(file));
      checkPage(file, page, new Set(pages));
    }

    for (const file of markdownFiles(docsRoot)) {
      if (file === join(docsRoot, 'README.md')) continue;
      if (nonPublishedRoots.some((directory) => file.startsWith(`${directory}${sep}`))) continue;
      if (!navigatedFiles.has(normalize(file))) fail(file, 'page is orphaned from docs.json navigation');
    }

    if (pages.length < 12) fail(configPath, `expected substantial product coverage; found only ${pages.length} pages`);
    console.log(`Checked ${pages.length} navigated documentation pages.`);
  }
}

if (errors.length) {
  console.error(`Documentation checks failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('Documentation navigation, metadata, headings, and local links are valid.');
}

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return ['.md', '.mdx'].includes(extname(entry.name)) ? [path] : [];
  });
}

function checkPage(file, route, routes) {
  const source = readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
  const frontmatter = source.match(/^---\n([\s\S]*?)\n---\n/);
  if (!frontmatter) {
    fail(file, 'missing YAML frontmatter');
    return;
  }
  const metadata = Object.fromEntries(
    frontmatter[1]
      .split('\n')
      .map((line) => line.match(/^([a-z_]+):\s*(.+)$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2].replace(/^['"]|['"]$/g, '')]),
  );
  for (const key of ['title', 'description', 'audience', 'content_type', 'last_reviewed', 'verified_against']) {
    if (!metadata[key]) fail(file, `missing ${key} frontmatter`);
  }
  if (metadata.description && (metadata.description.length < 70 || metadata.description.length > 180)) {
    fail(file, `description must be 70-180 characters (found ${metadata.description.length})`);
  }
  if (!['tutorial', 'how-to', 'reference', 'explanation'].includes(metadata.content_type)) {
    fail(file, `content_type must follow the tutorial/how-to/reference/explanation model`);
  }

  const body = source.slice(frontmatter[0].length);
  const withoutFences = body.replace(/```[\s\S]*?```/g, '');
  let previousLevel = 1;
  for (const match of withoutFences.matchAll(/^(#{2,6})\s+(.+)$/gm)) {
    const level = match[1].length;
    if (level > previousLevel + 1) fail(file, `heading "${match[2]}" skips from H${previousLevel} to H${level}`);
    previousLevel = level;
  }

  for (const match of body.matchAll(/!?(?:\[[^\]]*\])\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1];
    if (/^(?:https?:|mailto:|#)/.test(target)) continue;
    const clean = target.split('#')[0].split('?')[0];
    if (!clean) continue;
    if (target.startsWith('/')) {
      const routeTarget = clean.replace(/^\/+|\/$/g, '');
      if (!routes.has(routeTarget)) fail(file, `local route "${clean}" is absent from docs.json navigation`);
      continue;
    }
    const resolved = resolve(dirname(file), clean);
    if (!resolved.startsWith(`${docsRoot}${sep}`) && resolved !== docsRoot) {
      fail(file, `local link escapes the docs directory: "${clean}"`);
    } else if (!existsSync(resolved)) {
      fail(file, `local link target does not exist: "${clean}"`);
    }
  }

  if (!body.match(/^##\s+/m)) fail(file, `route "${route}" needs at least one H2 section`);
}
