import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const shellPath = (path) => path.replaceAll('\\', '/').replace(/^([A-Z]):/i, (_, drive) => `/${drive.toLowerCase()}`);

for (const scenario of [
  'bundled',
  'coolify',
  'missing-container',
  'missing-volume',
  'missing-volume-record',
  'wrong-project',
  'wrong-override',
  'dump-failure',
  'archive-failure',
  'external-with-bundled-maxio',
  'unset-endpoint',
  'external',
]) {
  test(`backup: ${scenario}`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'nibleaf-backup-'));
    try {
      const bin = join(directory, 'bin');
      const backups = join(directory, 'backups');
      mkdirSync(bin);
      mkdirSync(backups);
      writeFileSync(join(directory, 'compose.yml'), 'name: custom-install\n');
      const oldBackup = join(backups, 'nibleaf-old.dump');
      writeFileSync(oldBackup, 'previous successful backup');
      utimesSync(oldBackup, new Date(0), new Date(0));
      const docker = join(bin, 'docker');
      writeFileSync(
        docker,
        `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >> "$CALL_LOG"
case "$*" in
  *'ps -q postgres') echo pg-selected ;;
  *'ps --all -q server') echo server-selected ;;
  *'ps --all -q maxio') if [[ "$SCENARIO" != missing-container ]]; then echo maxio-selected; fi ;;
  inspect*.Config.Env*)
    if [[ "$SCENARIO" = external || "$SCENARIO" = external-with-bundled-maxio ]]; then echo 'STORAGE_ENDPOINT=https://external-storage.example.test';
    elif [[ "$SCENARIO" != unset-endpoint ]]; then echo 'STORAGE_ENDPOINT=http://maxio:9000'; fi ;;
  inspect*com.docker.compose.project*)
    if [[ "$SCENARIO" = wrong-project && "$*" = *maxio-selected ]]; then echo another-install; else echo "$COMPOSE_PROJECT_NAME"; fi ;;
  inspect*.Mounts*) if [[ "$SCENARIO" != missing-volume ]]; then echo "\${COMPOSE_PROJECT_NAME}_nibleaf-maxio"; fi ;;
  'volume inspect '*) [[ "$SCENARIO" != missing-volume-record ]] ;;
  *'exec -T postgres pg_dump '*) [[ "$SCENARIO" != dump-failure ]] || exit 1; printf 'synthetic database dump' ;;
  'run --rm '*) [[ "$SCENARIO" != archive-failure ]] || exit 1; printf 'synthetic storage archive' ;;
  *) echo "Unexpected fake Docker call: $*" >&2; exit 9 ;;
esac
`,
      );
      chmodSync(docker, 0o755);
      const project = scenario === 'coolify' ? 'nibleaf-coolify' : 'custom-install';
      const result = spawnSync(bash, ['-c', 'export PATH="$FIXTURE_BIN:$PATH"; exec bash "$BACKUP_SCRIPT"'], {
        cwd: directory,
        encoding: 'utf8',
        env: {
          ...process.env,
          FIXTURE_BIN: shellPath(bin),
          BACKUP_SCRIPT: shellPath(join(root, 'scripts/backup.sh')),
          COMPOSE_FILE: shellPath(join(directory, 'compose.yml')),
          COMPOSE_PROJECT_NAME: project,
          BACKUP_DIR: shellPath(backups),
          BACKUP_STORAGE: scenario === 'external' ? 'external' : 'bundled',
          STORAGE_ENDPOINT: scenario.startsWith('external') ? 'http://maxio:9000' : 'https://stale-environment.example.test',
          STORAGE_VOLUME: scenario === 'wrong-override' ? 'another-install_nibleaf-maxio' : '',
          PGUSER: scenario === 'coolify' ? 'synthetic-coolify-user' : 'nibleaf',
          PGDATABASE: scenario === 'coolify' ? 'synthetic-coolify-db' : 'nibleaf',
          RETENTION_DAYS: '14',
          CALL_LOG: shellPath(join(directory, 'calls.log')),
          SCENARIO: scenario,
        },
      });
      const success = ['bundled', 'coolify', 'external'].includes(scenario);
      assert.equal(result.status === 0, success, result.stderr || result.stdout);
      const calls = readFileSync(join(directory, 'calls.log'), 'utf8');
      assert.doesNotMatch(calls, /-v nibleaf_nibleaf-maxio:/);
      if (scenario === 'coolify') assert.match(calls, /pg_dump -U synthetic-coolify-user -d synthetic-coolify-db/);
      const files = readdirSync(backups);
      assert.ok(files.every((file) => !file.endsWith('.partial')));
      if (success) {
        const manifest = JSON.parse(
          readFileSync(
            join(
              backups,
              files.find((file) => file.endsWith('.json')),
            ),
            'utf8',
          ),
        );
        assert.equal(manifest.project, project);
        assert.equal(manifest.storageVolume, scenario === 'external' ? '' : `${project}_nibleaf-maxio`);
        assert.equal(readFileSync(join(backups, manifest.databaseFile), 'utf8'), 'synthetic database dump');
        if (scenario === 'external') {
          assert.doesNotMatch(calls, /run --rm/);
          assert.match(result.stdout, /database-only backup complete/);
          assert.match(result.stdout, /external objects were NOT backed up/);
        } else assert.equal(readFileSync(join(backups, manifest.storageFile), 'utf8'), 'synthetic storage archive');
        if (process.platform !== 'win32') {
          for (const file of files) assert.equal(statSync(join(backups, file)).mode & 0o077, 0);
        }
        assert.equal(existsSync(oldBackup), false);
      } else {
        assert.equal(existsSync(oldBackup), true, 'failure must not prune previous backups');
        assert.ok(
          files.every((file) => !file.endsWith('.json')),
          'failure must not publish a success manifest',
        );
        if (['external-with-bundled-maxio', 'unset-endpoint'].includes(scenario)) {
          assert.match(result.stderr, /BACKUP_STORAGE=external for a database-only backup/);
          assert.doesNotMatch(calls, /pg_dump|run --rm/);
        }
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
