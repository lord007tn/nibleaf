import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

export const legacySuites = [
  ['@nibleaf/server', 'src/actions/viewer-role.postgres.test.ts', 'VIEWER_ROLE_INTEGRATION'],
  ['@nibleaf/server', 'src/actions/join-links.postgres.test.ts', 'JOIN_LINKS_INTEGRATION'],
  ['@nibleaf/server', 'src/actions/people.postgres.test.ts', 'PEOPLE_INTEGRATION'],
  ['@nibleaf/server', 'src/actions/reader-access.postgres.test.ts', 'READER_ACCESS_POSTGRES'],
  ['@nibleaf/server', 'src/actions/site-sign-in.postgres.test.ts', 'PRIVATE_SITE_INTEGRATION'],
  ['@nibleaf/server', 'src/actions/admin.postgres.test.ts', 'ADMIN_POSTGRES'],
  ['@nibleaf/server', 'src/actions/data-integrity.postgres.test.ts', 'DATA_INTEGRITY_POSTGRES'],
  ['@nibleaf/auth', 'src/better-auth.postgres.test.ts', 'AUTH_INTEGRATION'],
];

export function validateLegacyTarget(url) {
  const target = new URL(url);
  if (target.hostname !== '127.0.0.1' || target.port !== '5562' || !/^\/orgs_legacy_[a-z0-9_]+$/.test(target.pathname)) {
    throw new Error('Use an owned orgs_legacy_* database at 127.0.0.1:5562');
  }
}

function main() {
  validateLegacyTarget(process.env.POSTGRES_URL ?? '');
  const oldTree = resolve(process.argv[2] ?? '');
  const artifactDir = resolve(process.argv[3] ?? '.cache/legacy-schema-compat');
  if (!existsSync(resolve(oldTree, '.git'))) throw new Error('Pass the detached origin/main worktree');
  if (/["&|<>^%]/.test(oldTree)) throw new Error('Unsupported worktree path');
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: oldTree, encoding: 'utf8' });
  if (revision.status !== 0 || !revision.stdout.trim().startsWith('8a3ce217')) throw new Error('Expected previous release 8a3ce217');
  mkdirSync(artifactDir, { recursive: true });
  const root = fileURLToPath(new URL('../', import.meta.url));
  const scenario = resolve(oldTree, 'apps/server/src/scripts/legacy-compat-scenario.test.ts');
  const rollbackScenario = resolve(oldTree, 'apps/server/src/scripts/legacy-rollback-scenario.test.ts');
  if (existsSync(scenario) || existsSync(rollbackScenario)) throw new Error('Refusing to overwrite an existing scenario');
  copyFileSync(resolve(root, 'scripts/legacy-compat-scenario.fixture'), scenario);
  copyFileSync(resolve(root, 'scripts/legacy-rollback-scenario.fixture'), rollbackScenario);
  const env = { ...process.env, LEGACY_COMPAT_RESULT: resolve(artifactDir, 'scenario.json') };
  const cleanupAdapter = process.argv.includes('--cleanup-adapter');
  const config = resolve(oldTree, 'apps/server/.legacy-compat.vitest.config.ts');
  const setup = resolve(oldTree, 'apps/server/.legacy-compat.setup.ts');
  if (cleanupAdapter) {
    if (existsSync(config) || existsSync(setup)) throw new Error('Cleanup adapter files already exist');
    writeFileSync(
      config,
      `import base from './vitest.config.ts';\nexport default {...base,test:{...base.test,setupFiles:['./.legacy-compat.setup.ts']}};\n`,
    );
    writeFileSync(
      setup,
      `import {prisma} from '@nibleaf/database';
const remove = prisma.organization.deleteMany.bind(prisma.organization);
prisma.organization.deleteMany = async (args) => {
  const ids = args?.where?.id?.in;
  if (!Array.isArray(ids) || !ids.length || !ids.every(id=>typeof id==='string')) throw new Error('Cleanup adapter requires exact fixture ids');
  await prisma.project.deleteMany({where:{organizationId:{in:ids}}});
  return remove(args);
};\n`,
    );
  }
  const results = [];
  const run = (cwd, args, extra = {}) => {
    // Every argument is from the fixed inventory below, never user text.
    const command = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'pnpm';
    const commandArgs = process.platform === 'win32' ? ['/d', '/s', '/c', `pnpm ${args.join(' ')}`] : args;
    const result = spawnSync(command, commandArgs, { cwd, env: { ...env, ...extra }, encoding: 'utf8' });
    const label = args.join(' ');
    const log = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    writeFileSync(resolve(artifactDir, `${results.length}.log`), log);
    const counts = [...log.matchAll(/Tests\s+([^\r\n]+)/g)].map((match) => stripVTControlCharacters(match[1]));
    results.push({ command: label, exitCode: result.status, counts });
    console.log(`${result.status === 0 ? 'PASS' : 'FAIL'} ${label}: ${counts.join(', ')}`);
    return result.status === 0;
  };
  try {
    for (const [pkg, suite, gate] of legacySuites)
      run(
        oldTree,
        [
          '--filter',
          pkg,
          'exec',
          'vitest',
          'run',
          suite,
          '--maxWorkers=1',
          ...(cleanupAdapter && pkg === '@nibleaf/server' ? ['--config', '.legacy-compat.vitest.config.ts'] : []),
        ],
        { [gate]: '1' },
      );
    run(oldTree, ['--filter', '@nibleaf/server', 'exec', 'vitest', 'run', 'src/scripts/legacy-compat-scenario.test.ts', '--maxWorkers=1']);
    // Rollback: the new release changes access, then the previous release runs on it.
    run(root, ['--filter', '@nibleaf/server', 'exec', 'vitest', 'run', 'src/scripts/legacy-rollback-setup.postgres.test.ts', '--maxWorkers=1'], {
      LEGACY_ROLLBACK_SETUP: '1',
    });
    run(oldTree, ['--filter', '@nibleaf/server', 'exec', 'vitest', 'run', 'src/scripts/legacy-rollback-scenario.test.ts', '--maxWorkers=1']);
    if (existsSync(env.LEGACY_COMPAT_RESULT))
      run(root, ['--filter', '@nibleaf/server', 'exec', 'vitest', 'run', 'src/scripts/legacy-schema-compat.postgres.test.ts', '--maxWorkers=1'], {
        LEGACY_SCHEMA_COMPAT: '1',
      });
  } finally {
    rmSync(scenario);
    rmSync(rollbackScenario);
    if (cleanupAdapter) {
      rmSync(config);
      rmSync(setup);
    }
    writeFileSync(
      resolve(artifactDir, 'results.json'),
      `${JSON.stringify({ revision: revision.stdout.trim(), cleanupAdapter, results }, null, 2)}\n`,
    );
  }
  if (results.some((result) => result.exitCode !== 0) || !existsSync(env.LEGACY_COMPAT_RESULT)) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
