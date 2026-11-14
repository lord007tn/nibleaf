import { prisma } from '@nibleaf/database';
import type { ImportTarget } from './persistence';

export interface ImportDestinations {
  documents: Map<string, string>;
  groups: Map<string, string>;
}

/** Source documents and navigation groups have separate identities, even at the same authored path. */
export class ImportFinalPaths {
  changed = false;
  private readonly scopes: Array<{ target: ImportTarget; routes: Map<string, string>; destinations: ImportDestinations }> = [];

  add(target: ImportTarget, routes: Map<string, string>): ImportDestinations {
    const destinations = { documents: new Map<string, string>(), groups: new Map<string, string>() };
    this.scopes.push({ target, routes, destinations });
    return destinations;
  }

  async resolve(): Promise<void> {
    for (const {
      target,
      routes,
      destinations: { documents, groups },
    } of this.scopes) {
      const pages = await prisma.page.findMany({
        where: { projectId: target.projectId, branchId: target.branchId, languageId: target.languageId },
        select: { id: true, path: true, kind: true },
      });
      const paths = new Map(pages.map(({ id, path }) => [id, `/${path.replace(/^\/+/, '')}`]));
      const importedIds = new Set([...documents.values(), ...groups.values()]);
      const existingPages = new Set(
        pages.filter((page) => page.kind === 'PAGE' && !importedIds.has(page.id)).map((page) => page.path.replace(/^\/+/, '')),
      );
      const aliases = new Map<string, string>();
      for (const [source, planned] of routes) {
        const id = documents.get(source);
        const path = id && paths.get(id);
        if (!path) throw new Error(`An imported destination disappeared before content was written: ${source} (${id}).`);
        routes.set(source, path);
        if (path !== planned) {
          this.changed = true;
          aliases.set(planned.replace(/^\/+/, ''), path);
        }
      }
      // Source document paths win for source-tree links. Inferred public aliases
      // and groups must never take over an existing, non-imported PAGE address.
      for (const [source, path] of aliases) if (!routes.has(source) && !existingPages.has(source)) routes.set(source, path);
      for (const [source, id] of groups) {
        const path = paths.get(id);
        if (!path) throw new Error(`An imported group disappeared before content was written: ${source}.`);
        if (path !== `/${source}`) {
          this.changed = true;
          if (!routes.has(source) && !existingPages.has(source)) routes.set(source, path);
        }
      }
    }
  }
}
