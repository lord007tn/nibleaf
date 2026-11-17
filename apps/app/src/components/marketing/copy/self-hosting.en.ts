import type { SelfHostingCopy } from './types';

export const selfHostingEn: SelfHostingCopy = {
  meta: {
    title: 'Nibleaf self-hosting status and deployment architecture',
    description: 'Install Nibleaf with the public Docker Compose release, then configure DNS, TLS, backups, and monitoring for your environment.',
    breadcrumb: ['Home', 'Self-hosting'],
  },
  header: {
    eyebrow: 'Self-hosting status',
    title: 'Run Nibleaf on your own infrastructure',
    body: 'The AGPL-3.0 source repository and pinned GHCR release are publicly accessible. The guided installer is fetched from a versioned release, verified before execution, then verifies the production Compose file before it writes configuration or starts any service.',
    checksTitle: 'Distribution checks completed',
    checks: [
      'The repository can be cloned without GitHub credentials.',
      'The pinned container release can be fetched anonymously from GHCR.',
      'The installer and production Compose file are pinned to one release and protected by committed SHA-256 digests.',
      'The production Compose file keeps PostgreSQL, cache, workers, and storage on the internal network.',
      'The install path is tested on a disposable Linux runner before release.',
    ],
    guide: { label: 'Follow the deployment guide', href: '/blog/self-host-documentation-site-docker-compose' },
  },
  architecture: {
    title: 'What the deployment contains',
    body: 'The Compose design runs several cooperating services. Understanding those boundaries matters before choosing a host, estimating memory, or writing a recovery plan.',
    items: [
      {
        title: 'Application and workers',
        body: 'The web application serves the editor, marketing pages, API, and published sites. Background workers handle asynchronous jobs.',
      },
      {
        title: 'PostgreSQL and Redis',
        body: 'PostgreSQL stores application data. Redis supports queues and coordination. Both need durable storage and an explicit recovery procedure.',
      },
      {
        title: 'Object storage',
        body: 'An S3-compatible service stores uploaded assets. Backups must cover the database and object storage from the same recovery point.',
      },
      {
        title: 'Ingress and DNS',
        body: 'TLS, the main application hostname, project subdomains, and custom domains depend on correctly configured ingress and DNS records.',
      },
    ],
  },
  verify: {
    title: 'What to verify before serving readers',
    paragraphs: [
      'A successful container start is only the first check. Publish a disposable test project, confirm its canonical URL and sitemap, upload and retrieve an asset, exercise a background job, and restore both data stores into a clean environment. Test a missing page too: it must return an actual HTTP 404 rather than a 200 response with a not-found message.',
      'Keep the application image pinned to a release or digest, record every required environment variable, and monitor the health endpoint during upgrades. A successful installer run does not replace operational work: configure TLS, schedule database and object-storage backups, test restoration in an isolated environment, and document rollback before moving production content.',
    ],
  },
};
