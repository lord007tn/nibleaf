import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

// Only the Docker build uses these reserved origins. Normal hosted/source builds
// keep Vite's existing configuration. Restrict replacements to safe URL origins
// so they remain valid in both single- and double-quoted generated JavaScript.
function origin(value, name) {
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !/^[a-z0-9.:[\]-]+$/i.test(url.host) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${name} must be an HTTP(S) origin without credentials, a path, query, or fragment.`);
  }
  return url.origin;
}

const output = process.argv[2];
if (!output) throw new Error('Usage: node scripts/configure-web-runtime.mjs <output-directory>');
const siteDomain = process.env.SITE_BASE_DOMAIN ?? '';
if (siteDomain && !/^[a-z0-9.-]+(?::[0-9]+)?$/i.test(siteDomain)) throw new Error('SITE_BASE_DOMAIN must be a hostname.');
const replacements = [
  ['https://nibleaf-runtime-app.invalid', origin(process.env.APP_URL, 'APP_URL')],
  ['http://nibleaf-runtime-api.invalid', origin(process.env.API_URL ?? 'http://server:4311', 'API_URL')],
  ['nibleaf-runtime-site.invalid', siteDomain],
];
const changedAssets = new Map();

async function configure(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await configure(path);
    } else if (entry.isFile() && /\.(?:m?js|json|html)$/.test(entry.name)) {
      // Retain only files with markers, allowing restart with changed runtime env.
      const template = `${path}.nibleaf-runtime-template`;
      const source = await readFile(existsSync(template) ? template : path, 'utf8');
      if (!replacements.some(([marker]) => source.includes(marker))) {
        if (existsSync(template)) await writeFile(path, source);
        continue;
      }
      if (!existsSync(template)) await writeFile(template, source, { mode: 0o600 });
      let configured = source;
      for (const [marker, value] of replacements) configured = configured.replaceAll(marker, value);
      await writeFile(path, configured);
      if (path.startsWith(join(output, 'public'))) {
        changedAssets.set(resolve(path), {
          size: Buffer.byteLength(configured),
          etag: `"${createHash('sha256').update(configured).digest('hex')}"`,
          mtime: new Date().toISOString(),
        });
      }
      // Nitro must not serve a precompressed copy containing the build markers.
      await Promise.all(['.gz', '.br', '.zst'].map((suffix) => rm(`${path}${suffix}`, { force: true })));
    }
  }
}

await configure(output);

if (changedAssets.size) {
  // Nitro embeds static asset metadata in its server entry. Changing JS bytes
  // requires changing Content-Length/ETag too, and removing stale encodings.
  // Fail closed if a future Nitro version changes this generated contract.
  const entry = join(output, 'server', 'index.mjs');
  const source = await readFile(entry, 'utf8');
  const template = `${entry}.nibleaf-runtime-template`;
  if (!existsSync(template)) await writeFile(template, source, { mode: 0o600 });
  const manifestPattern = /(var public_assets_data_default = )(\{[\s\S]*?\n\});/;
  if (!manifestPattern.test(source)) throw new Error('Unsupported Nitro public asset manifest; runtime configuration cannot be served safely.');
  const configured = source.replace(manifestPattern, (_, declaration, json) => {
    const assets = JSON.parse(json);
    for (const [id, asset] of Object.entries(assets)) {
      const path = resolve(dirname(entry), asset.path);
      const metadata = changedAssets.get(path);
      if (metadata) Object.assign(asset, metadata);
      else if (changedAssets.has(path.replace(/\.(?:gz|br|zst)$/, ''))) delete assets[id];
    }
    return `${declaration}${JSON.stringify(assets)};`;
  });
  // Runtime-configured bytes retain their build filenames. Revalidate instead
  // of caching a previous installation configuration as immutable for a year.
  await writeFile(entry, configured.replaceAll('public, max-age=31536000, immutable', 'public, max-age=0, must-revalidate'));
}
