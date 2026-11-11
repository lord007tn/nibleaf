import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { request } from 'node:http';

// Run against the built app in CI. A built file under /assets/ is cached as
// immutable and marked as static build output for the custom-domain edge. A file
// that does not exist must be a 404 that nothing stores: no immutable, no marker.
const origin = process.argv[2] ?? 'http://127.0.0.1:3000';
const publicAssets = new URL('../.output/public/assets/', import.meta.url);

const get = (path, method = 'GET') =>
  new Promise((resolve, reject) => {
    const req = request(new URL(path, origin), { method }, (res) => {
      res.resume();
      res.on('end', () => resolve({ headers: res.headers, status: res.statusCode }));
    });
    req.setTimeout(30_000, () => req.destroy(new Error(`Asset cache check timed out on ${path}`)));
    req.on('error', reject);
    req.end();
  });

const built = readdirSync(publicAssets).find((name) => /-[\w-]{8}\.js$/.test(name));
assert.ok(built, 'the build wrote no hashed JavaScript under .output/public/assets');

for (const method of ['GET', 'HEAD']) {
  const existing = await get(`/assets/${built}`, method);
  assert.equal(existing.status, 200, `${method} existing ${built}`);
  assert.equal(existing.headers['cache-control'], 'public, max-age=31536000, immutable', `${method} existing ${built}`);
  assert.equal(existing.headers['x-nibleaf-static-build'], '1', `${method} existing ${built}`);

  for (const missing of ['/assets/missing-DmVhZ3Nz.js', '/assets/missing.json']) {
    const response = await get(missing, method);
    assert.equal(response.status, 404, `${method} ${missing}`);
    assert.equal(response.headers['cache-control'], 'no-store', `${method} ${missing}`);
    assert.equal(response.headers['x-nibleaf-static-build'], undefined, `${method} ${missing}`);
  }
}
console.log(`Asset cache: ${built} is immutable; missing assets are uncached 404s.`);
