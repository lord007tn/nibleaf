import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { assertUnusedProject } from './self-host-safety.mjs';

test('isolated pre-migration dump restores into an empty target and fails closed on error', {
  skip: process.env.SELF_HOST_RESTORE_DRILL !== '1',
}, async () => {
  // The task reserves this exact project name. Refuse it if occupied, including
  // stopped containers or retained volumes, before setup or cleanup can run.
  assertUnusedProject('nibleaf-selfhost');
  // No published ports, application services or shared volumes. The fixture
  // reproduces the parent/new-FK-table boundary of a forward-only migration.
  const compose = `services:
  restore-postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: fixture
      POSTGRES_PASSWORD: fixture
      POSTGRES_DB: original
    tmpfs:
      - /var/lib/postgresql/data
  restore-storage:
    image: alpine:3.22
    command: ["sleep", "infinity"]
    tmpfs:
      - /data
`;
  const docker = (args, input) => execFileSync('docker', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  const dc = (...args) => docker(['compose', '-p', 'nibleaf-selfhost', '-f', '-', ...args], compose);
  const sql = (database, query) =>
    docker(['exec', container, 'psql', '-U', 'fixture', '-d', database, '-v', 'ON_ERROR_STOP=1', '-Atc', query]).trim();
  let container;
  try {
    dc('up', '-d', 'restore-postgres', 'restore-storage');
    container = dc('ps', '-q', 'restore-postgres').trim();
    assert.ok(container);
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        docker(['exec', container, 'pg_isready', '-U', 'fixture', '-d', 'original']);
        ready = true;
        break;
      } catch {
        await new Promise((done) => setTimeout(done, 1000));
      }
    }
    assert.ok(ready, 'owned PostgreSQL became ready');
    sql(
      'original',
      "CREATE TABLE project(id text PRIMARY KEY, title text NOT NULL); INSERT INTO project VALUES ('fictional-project', 'وثائق الاختبار');",
    );
    docker(['exec', container, 'pg_dump', '-U', 'fixture', '-d', 'original', '--format=custom', '-f', '/tmp/pre-migration.dump']);
    sql('original', 'CREATE TABLE integration(id text PRIMARY KEY, project_id text REFERENCES project(id));');
    sql('original', 'CREATE DATABASE restored;');
    assert.equal(sql('restored', "SELECT count(*) FROM pg_tables WHERE schemaname='public'"), '0');
    docker(['exec', container, 'pg_restore', '-U', 'fixture', '-d', 'restored', '--exit-on-error', '/tmp/pre-migration.dump']);
    assert.equal(sql('restored', 'SELECT id FROM project'), 'fictional-project');
    assert.equal(sql('restored', 'SELECT title FROM project'), 'وثائق الاختبار');
    assert.equal(sql('restored', "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='integration'"), '0');
    assert.equal(sql('original', "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='integration'"), '1');
    // Repeating into an occupied target fails. No application is ever started.
    assert.throws(() => docker(['exec', container, 'pg_restore', '-U', 'fixture', '-d', 'restored', '--exit-on-error', '/tmp/pre-migration.dump']));
    assert.equal(sql('restored', 'SELECT count(*) FROM project'), '1');
    // Exercise the runbook's archive/extract guard with a referenced fictional
    // asset. This verifies storage bytes, not a provider's S3 implementation.
    sql('restored', "ALTER TABLE project ADD COLUMN asset text; UPDATE project SET asset='fictional-asset.txt';");
    const asset = sql('restored', 'SELECT asset FROM project');
    docker(['exec', container, 'sh', '-ec', `mkdir /tmp/assets; printf 'fictional asset bytes' > /tmp/assets/${asset}`]);
    const archive = execFileSync('docker', ['exec', container, 'tar', 'czf', '-', '-C', '/tmp/assets', '.']);
    const storage = dc('ps', '-q', 'restore-storage').trim();
    docker(['exec', '-i', storage, 'sh', '-ec', 'test -z "$(ls -A /data)"; tar xzf - -C /data'], archive);
    assert.equal(docker(['exec', storage, 'cat', `/data/${asset}`]), 'fictional asset bytes');
    assert.throws(() => docker(['exec', '-i', storage, 'sh', '-ec', 'test -z "$(ls -A /data)"; tar xzf - -C /data'], archive));
    assert.equal(docker(['exec', storage, 'cat', `/data/${asset}`]), 'fictional asset bytes');
    process.stdout.write(
      'Restore receipt: PostgreSQL 17; fictional UTF-8 row and pre-migration schema recovered; original post-migration schema preserved; occupied-target restore rejected; no app services started.\n',
    );
  } finally {
    dc('down', '--volumes');
  }
});
