import { setTimeout } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const accept = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

// Fixed GHCR origin and no redirects: credentials must never follow a registry
// response to another host. Never expose response bodies or fetch error details.
const request = async (path, authorization, { fetch: fetchResponse = fetch, wait = setTimeout } = {}) => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    let response;
    let body;
    try {
      response = await fetchResponse(`https://ghcr.io${path}`, {
        headers: { Authorization: authorization, Accept: accept },
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });
      body = await response.text();
    } catch {
      if (attempt === 3) throw new Error('GHCR request failed after 3 attempts');
      await wait(attempt * 2000);
      continue;
    }
    if (response.status === 429 || response.status >= 500) {
      if (attempt === 3) throw new Error(`GHCR unavailable after 3 attempts (HTTP ${response.status})`);
      await wait(attempt * 2000);
      continue;
    }
    return { status: response.status, body };
  }
};

const parse = ({ body }) => {
  try {
    return JSON.parse(body);
  } catch {
    throw new Error('Malformed GHCR JSON response');
  }
};

export const rejectExistingImmutableTags = async ({ image, sourceSha, tag, username, token }, dependencies) => {
  if (!/^ghcr\.io\/[a-z0-9]+(?:[._-][a-z0-9]+)*\/[a-z0-9]+(?:[._-][a-z0-9]+)*$/u.test(image ?? '')) {
    throw new Error('Expected a lowercase GHCR owner/repository image');
  }
  if (!/^[0-9a-f]{40}$/u.test(sourceSha ?? '')) throw new Error('Source must be a full Git revision');
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/u.test(tag ?? '')) throw new Error('Invalid image tag');
  if (!username || !token || username.includes(':')) throw new Error('GHCR credentials are required');
  const repository = image.slice('ghcr.io/'.length);
  const scope = encodeURIComponent(`repository:${repository}:pull`);
  const credentials = Buffer.from(`${username}:${token}`).toString('base64');
  const auth = await request(`/token?service=ghcr.io&scope=${scope}`, `Basic ${credentials}`, dependencies);
  if (auth.status !== 200) throw new Error(`GHCR authentication failed (HTTP ${auth.status})`);
  const bearer = parse(auth)?.token;
  if (typeof bearer !== 'string' || !bearer || /\s/u.test(bearer)) throw new Error('Malformed GHCR token response');
  const authorization = `Bearer ${bearer}`;

  // A token alone does not establish pull permission. Require the registry to
  // authorize this repository before trusting any missing-manifest response.
  // A new repository needs a separately reviewed bootstrap, never a bypass here.
  const access = await request(`/v2/${repository}/tags/list?n=1`, authorization, dependencies);
  if (access.status !== 200) throw new Error(`GHCR repository read access not established (HTTP ${access.status})`);
  const listing = parse(access);
  if (listing?.name !== repository || !Array.isArray(listing.tags) || !listing.tags.every((entry) => typeof entry === 'string')) {
    throw new Error('Malformed GHCR repository read response');
  }

  const candidates = new Set([`sha-${sourceSha}`, ...(tag.startsWith('v') ? [tag] : [])]);
  for (const candidate of candidates) {
    const manifest = await request(`/v2/${repository}/manifests/${candidate}`, authorization, dependencies);
    if (manifest.status === 200) throw new Error(`Immutable image tag ${image}:${candidate} already exists`);
    if (manifest.status !== 404) throw new Error(`Immutable tag absence not established (HTTP ${manifest.status})`);
    const errors = parse(manifest)?.errors;
    if (!Array.isArray(errors) || errors.length === 0 || !errors.every((error) => error?.code === 'MANIFEST_UNKNOWN')) {
      throw new Error('Immutable tag absence not established by MANIFEST_UNKNOWN');
    }
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await rejectExistingImmutableTags({
      image: process.env.IMAGE,
      sourceSha: process.env.SOURCE_SHA,
      tag: process.env.TAG,
      username: process.env.GHCR_USERNAME,
      token: process.env.GHCR_TOKEN,
    });
    console.log('Authenticated GHCR checks confirm immutable tags are absent');
  } catch (error) {
    console.error(`Immutable tag guard failed: ${error.message}`);
    process.exitCode = 1;
  }
}
