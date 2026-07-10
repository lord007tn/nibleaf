import { prisma } from '@nibleaf/database';
import { strToU8, zipSync } from 'fflate';
import { notFound } from '@/errors';

/**
 * Markdown zip export. Page content is plain Markdown end-to-end, so the export
 * is a faithful copy of the docs: one `.md` file per page under
 * `<branch>/<language>/<page-path>.md`, plus a `project.json` manifest. Groups
 * are folders in the page paths, so they need no files of their own.
 */

export interface ProjectExportResult {
  fileName: string;
  data: Uint8Array;
}

/** Make a path safe inside the zip: strip traversal and normalize separators. */
const safeSegment = (value: string): string =>
  value
    .replace(/[\\/]+/g, '-')
    .replace(/\.\.+/g, '.')
    // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally strips control chars from zip entry names
    .replace(/[<>:"|?*\u0000-\u001f]/g, '')
    .trim() || 'untitled';

const safePath = (value: string): string =>
  value
    .split('/')
    .map((segment) => safeSegment(segment))
    .filter(Boolean)
    .join('/') || 'untitled';

/** YAML-quote a scalar for the export front matter. */
const yamlString = (value: string): string => JSON.stringify(value);

const frontMatter = (page: { title: string; description: string | null; icon: string | null; hidden: boolean }): string => {
  const lines = ['---', `title: ${yamlString(page.title)}`];
  if (page.description) {
    lines.push(`description: ${yamlString(page.description)}`);
  }
  if (page.icon) {
    lines.push(`icon: ${yamlString(page.icon)}`);
  }
  if (page.hidden) {
    lines.push('hidden: true');
  }
  lines.push('---', '');
  return lines.join('\n');
};

/** Build a zip of every page in a project as Markdown + a project.json manifest. */
export const exportProjectMarkdown = async (projectId: string): Promise<ProjectExportResult> => {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      languages: { orderBy: { position: 'asc' } },
      branches: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] },
    },
  });
  if (!project) {
    throw notFound('project', { projectId });
  }
  const pages = await prisma.page.findMany({
    where: { projectId },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    include: { language: { select: { code: true } }, branch: { select: { name: true } } },
  });

  const files: Record<string, Uint8Array> = {};
  const usedNames = new Set<string>();
  for (const page of pages) {
    if (page.kind !== 'PAGE') {
      continue;
    }
    const branch = safeSegment(page.branch.name);
    const language = safeSegment(page.language.code);
    let name = `${branch}/${language}/${safePath(page.path || page.slug || page.id)}.md`;
    if (usedNames.has(name)) {
      name = name.replace(/\.md$/, `-${page.id}.md`);
    }
    usedNames.add(name);
    files[name] = strToU8(`${frontMatter(page)}\n${page.content}`);
  }

  const manifest = {
    name: project.name,
    slug: project.slug,
    description: project.description,
    languages: project.languages.map((l) => ({ code: l.code, label: l.label, direction: l.direction, isDefault: l.isDefault })),
    branches: project.branches.map((b) => ({ name: b.name, isDefault: b.isDefault })),
    pagesCount: pages.filter((p) => p.kind === 'PAGE').length,
    exportedAt: new Date().toISOString(),
    generator: 'nibleaf',
  };
  files['project.json'] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  // Markdown compresses well and docs sites are small; a synchronous in-memory
  // zip (fflate) keeps this dependency-light and avoids temp files.
  const data = zipSync(files, { level: 6 });
  return { fileName: `${safeSegment(project.slug || 'project')}-docs-export.zip`, data };
};
