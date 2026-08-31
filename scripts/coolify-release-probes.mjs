export const publicTargets = [
  { name: 'app', url: 'https://nibleaf.com/', revision: 'required' },
  { name: 'app readiness', url: 'https://nibleaf.com/health', revision: 'required' },
  { name: 'api', url: 'https://nibleaf.com/api/app/health', revision: 'required' },
  { name: 'admin', url: 'https://admin.nibleaf.com/sign-in', revision: 'required' },
  { name: 'docs', url: 'https://docs.nibleaf.com/', revision: 'separate-publication' },
  { name: 'app sitemap', url: 'https://nibleaf.com/sitemap.xml', revision: 'required' },
  { name: 'docs sitemap', url: 'https://docs.nibleaf.com/sitemap.xml', revision: 'separate-publication' },
];

export const verifyTarget = async ({ name, url, revision: revisionContract }, expectedRevision, allowMissingRevision = false, fetchImpl = fetch) => {
  const response = await fetchImpl(url, {
    headers: { 'user-agent': 'nibleaf-release-verifier/1.0' },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status !== 200) throw new Error(`${name} returned HTTP ${response.status}.`);
  const revision = response.headers.get('x-nibleaf-revision');
  if (revisionContract === 'required' && revision !== expectedRevision && !(allowMissingRevision && revision === null)) {
    throw new Error(`${name} served revision ${revision ?? 'missing'}, expected ${expectedRevision}.`);
  }
  if (name === 'api') {
    const health = await response.json();
    if (health.ok !== true || health.revision !== expectedRevision) {
      throw new Error('API health body did not prove ok: true and the expected revision.');
    }
  } else if (name === 'app readiness') {
    const health = await response.json();
    if (health.status !== 'ok' || (health.revision !== expectedRevision && !(allowMissingRevision && health.revision === undefined))) {
      throw new Error('App readiness body did not prove the expected revision.');
    }
  } else {
    await response.body?.cancel();
  }
};
