import { prisma } from '@nibleaf/database';
import type { ImportTarget } from './persistence';

/** Source aliases keep their identity; only their destinations change after persistence. */
export class ImportFinalPaths {
  changed = false;
  private readonly scopes: Array<{ target: ImportTarget; routes: Map<string, string>; ids: Map<string, string> }> = [];

  add(target: ImportTarget, routes: Map<string, string>): Map<string, string> {
    const ids = new Map<string, string>();
    this.scopes.push({ target, routes, ids });
    return ids;
  }

  async resolve(): Promise<void> {
    for (const { target, routes, ids } of this.scopes) {
      const pages = await prisma.page.findMany({
        where: { projectId: target.projectId, branchId: target.branchId, languageId: target.languageId, id: { in: [...ids.values()] } },
        select: { id: true, path: true },
      });
      const paths = new Map(pages.map(({ id, path }) => [id, `/${path.replace(/^\/+/, '')}`]));
      const aliases = new Map<string, string>();
      for (const [source, planned] of routes) {
        const id = ids.get(source);
        const path = id && paths.get(id);
        if (!path) throw new Error(`An imported destination disappeared before content was written: ${source} (${id}).`);
        routes.set(source, path);
        if (path !== planned) {
          this.changed = true;
          aliases.set(planned.replace(/^\/+/, ''), path);
        }
      }
      // Some authored links already use the navigation's public path. Retain
      // that alias without shadowing an actual source file with the same name.
      for (const [source, path] of aliases) if (!routes.has(source)) routes.set(source, path);
      // Groups were not source documents in the original route map. Add only
      // renamed groups, keeping no-collision imports byte-for-byte compatible.
      for (const [source, id] of ids) {
        if (routes.has(source)) continue;
        const path = paths.get(id);
        if (!path) throw new Error(`An imported group disappeared before content was written: ${source}.`);
        if (path !== `/${source}`) {
          this.changed = true;
          routes.set(source, path);
        }
      }
    }
  }
}
