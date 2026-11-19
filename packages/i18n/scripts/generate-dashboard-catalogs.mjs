import * as fs from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '@inlang/paraglide-js';

// Use the same compiler as the scoped translators. In particular, do not
// reinterpret placeholders, selectors or plural expressions in the browser.
const outdir = fileURLToPath(new URL('../src/generated/dashboard', import.meta.url));
const insideOutput = (file) => {
  const path = resolve(file);
  const nested = relative(outdir, path);
  if (nested === '..' || nested.startsWith(`..${sep}`) || isAbsolute(nested)) throw new Error(`Catalog generation cannot write outside ${outdir}`);
  return path;
};

const compilerFs = {
  ...fs,
  promises: {
    ...fs.promises,
    mkdir: (file, options) => fs.promises.mkdir(insideOutput(file), options),
    rm: (file, options) => fs.promises.rm(insideOutput(file), options),
    unlink: (file) => fs.promises.unlink(insideOutput(file)),
    rmdir: (file) => fs.promises.rmdir(insideOutput(file)),
    writeFile: async (file, contents) => {
      const target = insideOutput(file);
      const bytes = Buffer.from(contents);
      try {
        if ((await fs.promises.readFile(target)).equals(bytes)) return;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      const temporary = join(dirname(target), `.catalog-${process.pid}-${process.hrtime.bigint()}.tmp`);
      try {
        await fs.promises.writeFile(temporary, bytes, { flag: 'wx' });
        await fs.promises.rename(temporary, target);
      } finally {
        await fs.promises.unlink(temporary).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
      }
    },
  },
};

let previousCompilation;
let publication = Promise.resolve();

/** Serialize the incremental compiler state with its atomic publication.
 * A rejected generation stays rejected for its caller, and can be retried. */
export function generateDashboardCatalogs() {
  const next = publication.then(async () => {
    previousCompilation = await compile({
      project: fileURLToPath(new URL('../project.inlang', import.meta.url)),
      outdir,
      fs: compilerFs,
      cleanOutdir: false,
      previousCompilation,
      outputStructure: 'locale-modules',
      emitTsDeclarations: true,
      strategy: ['cookie', 'preferredLanguage', 'baseLocale'],
    });
    // Locale modules expose compiler-safe identifiers; its public index keeps
    // canonical aliases (including camel-case IDs). Reuse that metadata rather
    // than duplicating Paraglide's identifier allocation/collision rules.
    const index = await fs.promises.readFile(join(outdir, 'messages/_index.js'), 'utf8');
    const aliases = Object.fromEntries(
      [...index.matchAll(/export\s*\{\s*([A-Za-z_$][\w$]*)\s+as\s+("(?:\\.|[^"\\])*")\s*\}/g)].map(([, identifier, quoted]) => [
        JSON.parse(quoted),
        identifier,
      ]),
    );
    await compilerFs.promises.writeFile(join(outdir, 'message-aliases.json'), `${JSON.stringify(aliases)}\n`);
  });
  publication = next.catch(() => undefined);
  return next;
}

if (import.meta.main) await generateDashboardCatalogs();
