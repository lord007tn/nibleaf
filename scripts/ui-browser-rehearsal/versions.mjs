// Records the dompurify and seroval versions the app build actually resolves.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const packageOf = (require, name) => {
  let dir = dirname(require.resolve(name));
  while (!existsSync(join(dir, 'package.json')) || JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name !== name) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`no package.json for ${name}`);
    dir = parent;
  }
  return { dir, version: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version };
};
const app = createRequire(join(process.cwd(), 'apps/app/package.json'));
const mermaid = packageOf(app, 'mermaid');
const dompurify = packageOf(createRequire(join(mermaid.dir, 'package.json')), 'dompurify');
const router = packageOf(app, '@tanstack/react-router');
const core = packageOf(createRequire(join(router.dir, 'package.json')), '@tanstack/router-core');
const seroval = packageOf(createRequire(join(core.dir, 'package.json')), 'seroval');
const bundled = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (path.endsWith('.js') || path.endsWith('.mjs')) {
      const text = readFileSync(path, 'utf8');
      if (text.includes(`"${dompurify.version}"`) && /DOMPurify|sanitize/.test(text)) bundled.push(path);
    }
  }
};
walk('apps/app/.output');
console.log(JSON.stringify({ mermaid: mermaid.version, dompurifyViaMermaid: dompurify.version, routerCore: core.version, serovalViaRouterCore: seroval.version, buildFilesWithDompurifyVersion: bundled }, null, 2));
