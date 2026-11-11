#!/usr/bin/env node
// Expand-only gate for Prisma migrations.
//
// Rolling deploys run new and old app containers side by side against one
// database, and a failed release rolls back to the previous image without
// restoring the database. Every migration that ships through the automatic
// path must therefore keep the PREVIOUS release working: add, never remove,
// rename, retype or tighten. See operations/runbook-rolling-deploys.md §4.
//
// Usage:
//   node scripts/migration-safety.mjs [--base <git-ref>] [files…]
// With no files, checks every migration.sql added or modified since <base>
// (default origin/main). Exits 1 when a migration contains a contract
// statement without an explicit, reasoned opt-out line:
//   -- nibleaf-migration: contract <reason, at least 12 characters>
// A contract migration then ships only as the runbook describes: never in the
// same release as the code that stops using the old shape.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const MIGRATIONS_GLOB = 'packages/database/prisma/migrations/*/migration.sql';
const CONTRACT_MARKER = /^--\s*nibleaf-migration:\s*contract\s+(.{12,})$/im;

const IDENT = String.raw`(?:"[^"]+"|[A-Za-z_][\w$]*)(?:\.(?:"[^"]+"|[A-Za-z_][\w$]*))?`;
const ALTER_TABLE = new RegExp(`^ALTER TABLE (?:ONLY )?(?:IF EXISTS )?(${IDENT})`, 'i');
const CREATE_TABLE = new RegExp(`^CREATE (?:UNLOGGED |TEMP(?:ORARY)? )?TABLE (?:IF NOT EXISTS )?(${IDENT})`, 'i');
const DROP_TABLE = new RegExp(String.raw`^DROP TABLE (?:IF EXISTS )?(${IDENT}(?:\s*,\s*${IDENT})*)`, 'i');
const UNIQUE_INDEX = new RegExp(`^CREATE UNIQUE INDEX (?:CONCURRENTLY )?(?:IF NOT EXISTS )?(?:${IDENT} )?ON (?:ONLY )?(${IDENT})`, 'i');
const ADD_COLUMN = new RegExp(String.raw`\bADD (?:COLUMN )?(?:IF NOT EXISTS )?(${IDENT})`, 'gi');

const unquote = (name) => (name.split('.').pop() ?? '').trim().replace(/^"|"$/g, '').toLowerCase();

/** Strip comments, dollar-quoted bodies (functions, DO blocks: runtime logic,
 *  not schema changes) and string literals, so keywords inside never match. */
const normalise = (sql) =>
  sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\$([A-Za-z_]\w*)?\$[\s\S]*?\$\1\$/g, '$$$$')
    .replace(/'(?:[^']|'')*'/g, "''");

const statements = (sql) =>
  normalise(sql)
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

/** Splits an ALTER TABLE body into its comma-separated actions, ignoring commas inside parentheses. */
const alterActions = (statement) => {
  const body = statement.replace(ALTER_TABLE, '');
  const actions = [];
  let depth = 0;
  let current = '';
  for (const char of body) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      actions.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) actions.push(current.trim());
  return actions;
};

/** What this migration itself creates: tables, and columns added to existing
 *  tables (`table.column`). The previous release never writes either, so
 *  constraining them cannot break it. */
const createdInMigration = (parts) => {
  const tables = new Set();
  const columns = new Set();
  for (const statement of parts) {
    const created = CREATE_TABLE.exec(statement)?.[1];
    if (created) tables.add(unquote(created));
    const altered = ALTER_TABLE.exec(statement)?.[1];
    if (!altered) continue;
    for (const action of alterActions(statement)) {
      if (/^ADD CONSTRAINT\b/i.test(action)) continue;
      for (const match of action.matchAll(ADD_COLUMN)) {
        if (match[1]) columns.add(`${unquote(altered)}.${unquote(match[1])}`);
      }
    }
  }
  return { tables, columns };
};

const indexColumns = (statement) => {
  const afterOn = statement.replace(/^.*?\bON\b[^(]*/i, '');
  return (/\(([^()]*)\)/.exec(afterOn)?.[1] ?? '')
    .split(',')
    .map((part) => unquote(part.trim().split(/\s+/)[0] ?? ''))
    .filter(Boolean);
};

const RULES = [
  {
    id: 'drop-table',
    why: 'drops a table the previous release may still read or write',
    test: (s, made) => {
      const names = DROP_TABLE.exec(s)?.[1];
      return Boolean(names) && names.split(',').some((name) => !made.tables.has(unquote(name)));
    },
  },
  {
    id: 'drop-column',
    why: 'drops a column the previous release may still use',
    // `DROP CONSTRAINT`, `ALTER COLUMN x DROP DEFAULT` and `DROP NOT NULL` relax, so they pass.
    test: (s) => ALTER_TABLE.test(s) && alterActions(s).some((action) => /^DROP (?:COLUMN )?(?:IF EXISTS )?(?!CONSTRAINT\b)["\w]/i.test(action)),
  },
  {
    id: 'rename',
    why: 'renames a table, column or enum value the previous release references by name',
    test: (s) => /^ALTER (?:TABLE|TYPE) .*\bRENAME\b/i.test(s),
  },
  {
    id: 'retype',
    why: 'changes a column type under the previous release',
    test: (s) => ALTER_TABLE.test(s) && alterActions(s).some((action) => /^ALTER (?:COLUMN )?\S+ (?:SET DATA )?TYPE\b/i.test(action)),
  },
  {
    id: 'drop-type',
    why: 'drops an enum or type (Prisma recreates enums when values are removed)',
    test: (s) => /^DROP TYPE\b/i.test(s),
  },
  {
    id: 'set-not-null',
    why: 'makes a column required while the previous release may still write NULL',
    test: (s, made) => {
      const table = ALTER_TABLE.exec(s)?.[1];
      return Boolean(table) && !made.tables.has(unquote(table)) && alterActions(s).some((action) => /\bSET NOT NULL\b/i.test(action));
    },
  },
  {
    id: 'add-required-column',
    why: 'adds a NOT NULL column without a default, which the previous release cannot insert',
    test: (s, made) => {
      const table = ALTER_TABLE.exec(s)?.[1];
      if (!table || made.tables.has(unquote(table))) return false;
      return alterActions(s).some(
        (action) => /^ADD (?:COLUMN )?(?!CONSTRAINT\b)/i.test(action) && /\bNOT NULL\b/i.test(action) && !/\b(?:DEFAULT|GENERATED)\b/i.test(action),
      );
    },
  },
  {
    id: 'tighten-unique-or-check',
    why: 'adds a uniqueness or check constraint to existing data that the previous release may violate',
    test: (s, made) => {
      const indexed = UNIQUE_INDEX.exec(s)?.[1];
      if (indexed) {
        const table = unquote(indexed);
        if (made.tables.has(table)) return false;
        // Rows the previous release writes leave a column added here NULL, and
        // NULLs never collide in a unique index unless NULLS NOT DISTINCT.
        const columns = indexColumns(s);
        const touchesNewColumn = columns.some((column) => made.columns.has(`${table}.${column}`));
        return !(touchesNewColumn && !/\bNULLS NOT DISTINCT\b/i.test(s));
      }
      const table = ALTER_TABLE.exec(s)?.[1];
      return (
        Boolean(table) &&
        !made.tables.has(unquote(table)) &&
        alterActions(s).some((action) => /^ADD CONSTRAINT \S+ (?:UNIQUE|CHECK|EXCLUDE)\b/i.test(action) && !/\bNOT VALID\b/i.test(action))
      );
    },
  },
  {
    id: 'delete-data',
    why: 'deletes rows the previous release may depend on',
    test: (s) => /^(?:TRUNCATE|DELETE FROM)\b/i.test(s),
  },
];

/** @returns {{ id: string, why: string, statement: string }[]} */
export const findContractStatements = (sql) => {
  const parts = statements(sql);
  const made = createdInMigration(parts);
  const findings = [];
  for (const statement of parts) {
    for (const rule of RULES) {
      if (rule.test(statement, made)) findings.push({ id: rule.id, why: rule.why, statement: statement.slice(0, 160) });
    }
  }
  return findings;
};

export const contractOptOut = (sql) => CONTRACT_MARKER.exec(sql)?.[1]?.trim() ?? null;

export const checkMigration = (file, sql) => {
  const findings = findContractStatements(sql);
  const reason = contractOptOut(sql);
  return { file, findings, reason, ok: findings.length === 0 || reason !== null };
};

const changedMigrations = (base) =>
  execFileSync('git', ['diff', '--name-only', '--diff-filter=AMR', `${base}...HEAD`, '--', MIGRATIONS_GLOB], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

const main = () => {
  const args = process.argv.slice(2);
  const baseIndex = args.indexOf('--base');
  const base = baseIndex >= 0 ? args.splice(baseIndex, 2)[1] : 'origin/main';
  const files = args.length ? args : changedMigrations(base);
  if (!files.length) {
    console.log('migration-safety: no changed migrations.');
    return;
  }
  let failed = false;
  for (const file of files) {
    const result = checkMigration(file, readFileSync(file, 'utf8'));
    if (!result.findings.length) {
      console.log(`ok       ${file} (expand-only)`);
      continue;
    }
    if (result.ok) {
      console.log(`CONTRACT ${file}: opted out (${result.reason})`);
      for (const finding of result.findings) console.log(`         - ${finding.id}: ${finding.statement}`);
      console.log('         Ships only per operations/runbook-rolling-deploys.md §4, never with the code that stops using the old shape.');
      continue;
    }
    failed = true;
    console.error(`::error file=${file}::Migration is not expand-only.`);
    for (const finding of result.findings) console.error(`  - ${finding.id}: ${finding.why}\n      ${finding.statement}`);
  }
  if (failed) {
    console.error(
      '\nRolling deploys run the previous release against the new schema. Split this into an expand migration now and a contract migration ' +
        'in a later release, or add `-- nibleaf-migration: contract <reason>` and follow operations/runbook-rolling-deploys.md §4.',
    );
    process.exit(1);
  }
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
