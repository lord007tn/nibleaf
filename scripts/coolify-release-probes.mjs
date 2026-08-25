export const publicTargets = [
  ['app', 'https://nibleaf.com/'],
  ['app readiness', 'https://nibleaf.com/health'],
  ['api', 'https://nibleaf.com/api/app/health'],
  ['admin', 'https://admin.nibleaf.com/sign-in'],
  ['docs', 'https://docs.nibleaf.com/'],
  ['app sitemap', 'https://nibleaf.com/sitemap.xml'],
  ['docs sitemap', 'https://docs.nibleaf.com/sitemap.xml'],
];

export const verifyTarget = async ([name, url], expectedRevision, allowMissingRevision = false, fetchImpl = fetch) => {
  const response = await fetchImpl(url, {
    headers: { 'user-agent': 'nibleaf-release-verifier/1.0' },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status !== 200) throw new Error(`${name} returned HTTP ${response.status}.`);
  const revision = response.headers.get('x-nibleaf-revision');
  if (revision !== expectedRevision && !(allowMissingRevision && revision === null)) {
    throw new Error(`${name} served revision ${revision ?? 'missing'}, expected ${expectedRevision}.`);
  }
  if (name === 'api') {
    const health = await response.json();
    if (health.ok !== true) throw new Error('API health body did not report ok: true.');
  } else if (name === 'app readiness') {
    const health = await response.json();
    if (health.status !== 'ok' || (health.revision !== expectedRevision && !(allowMissingRevision && health.revision === undefined))) {
      throw new Error('App readiness body did not prove the expected revision.');
    }
  } else {
    await response.body?.cancel();
  }
};
