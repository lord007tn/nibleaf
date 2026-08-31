import { readFile } from 'node:fs/promises';

const [workflow, dockerfile, compose, runbook] = await Promise.all([
  readFile('.github/workflows/docker.yml', 'utf8'),
  readFile('Dockerfile', 'utf8'),
  readFile('docker-compose.coolify.yml', 'utf8'),
  readFile('operations/deployment-reliability.md', 'utf8'),
]);

const requireMatch = (condition, message) => {
  if (!condition) throw new Error(`Release contract invalid: ${message}`);
};

requireMatch(/on:\s*\n\s*workflow_dispatch:/m.test(workflow), 'Docker workflow must remain workflow_dispatch-only');
requireMatch(!/pull_request\s*:/m.test(workflow), 'Docker workflow must never build on pull_request');
requireMatch(workflow.includes('nibleaf-production-release'), 'production releases need one non-cancelling concurrency lock');
requireMatch(workflow.includes('actions/attest@v4'), 'published images need source provenance');
requireMatch(workflow.includes('scripts/coolify-release.mjs'), 'deployment must use the fail-closed verifier and compensation path');
requireMatch(dockerfile.includes('FROM node:22-alpine'), 'production must stay on Node 22');
requireMatch(dockerfile.includes('org.opencontainers.image.revision=$REVISION'), 'image must carry the exact source revision');

for (const service of ['server', 'worker', 'app', 'admin']) {
  const section = compose.split(`  ${service}:`)[1]?.split(/\n {2}[a-z][a-z-]+:/)[0] ?? '';
  requireMatch(section.includes('healthcheck:'), `${service} requires a healthcheck`);
  requireMatch(section.includes('init: true'), `${service} requires an init process`);
  requireMatch(section.includes('stop_grace_period:'), `${service} requires a graceful stop window`);
}
requireMatch(compose.includes('PORT: "4315"') && compose.includes('"4315"'), 'admin must preserve the 4315 service contract');
requireMatch(/does\s+not support application-level rolling updates/.test(runbook), 'runbook must state the Compose limitation');
requireMatch(runbook.includes('Docker Image applications'), 'runbook must define the eligible rolling architecture');

process.stdout.write('Release contract is internally consistent.\n');
