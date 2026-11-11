#!/usr/bin/env node
// Expand-only gate for Prisma migrations. It FAILS CLOSED.
//
// Rolling deploys run the previous release against the new schema during the
// overlap, and a failed release rolls back to the previous image without
// restoring the database (operations/runbook-rolling-deploys.md §4). So a
// migration passes on its own only if every statement is PROVABLY expand-only.
//
// Each file is parsed with the real PostgreSQL 17 parser (libpg-query), not
// regular expressions, so comments, string literals, dollar quoting, quoted
// identifiers, schemas and case are all handled exactly as Postgres handles
// them. Statements are checked against an allowlist. Anything not on it,
// including any executable body we cannot analyse (DO blocks, functions,
// triggers), needs an explicit, reasoned opt-out line in the file:
//   -- nibleaf-migration: contract <reason, at least 12 characters>
// A file that does not parse fails even with the opt-out.
//
// Usage:
//   node scripts/migration-safety.mjs [--base <git-ref>] [files…]
// With no files, checks every migration.sql added or modified since <base>
// (default origin/main).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parse } from 'libpg-query';

const MIGRATIONS_GLOB = 'packages/database/prisma/migrations/*/migration.sql';
const CONTRACT_MARKER = /^--[ \t]*nibleaf-migration:[ \t]*contract[ \t]+(\S.{11,})$/m;

const WHY = {
  drop: 'drops an object the previous release may still use',
  rename: 'renames something the previous release references by name',
  retype: 'changes a column type under the previous release',
  'set-not-null': 'makes an existing column required while the previous release may still write NULL',
  'drop-default': 'removes a default the previous release may rely on when it omits the column',
  'add-required-column': 'adds a NOT NULL column without a default, which the previous release cannot insert',
  'tighten-constraint':
    'adds a constraint (unique, check, foreign key, exclusion) that existing data or the previous release may violate; NOT VALID still applies to new writes',
  'validate-constraint': 'validates a constraint against existing rows',
  'drop-constraint': 'drops a constraint or index (constraint drops are treated conservatively)',
  'data-change': 'changes or deletes existing rows (UPDATE, DELETE, TRUNCATE, or INSERT into an existing table)',
  unanalyzable: 'contains executable code (DO block, function, trigger, query) that cannot be checked statically',
  unknown: 'is not on the expand-only allowlist',
};

const nodeType = (node) => Object.keys(node ?? {})[0];
const qualified = (relation) => `${relation?.schemaname ?? 'public'}.${relation?.relname ?? ''}`;
const stringOf = (node) => node?.String?.sval;

/** Constraint flags on a column definition. */
const columnTraits = (columnDef) => {
  const constraints = (columnDef?.constraints ?? []).map((entry) => entry.Constraint ?? {});
  const types = new Set(constraints.map((constraint) => constraint.contype));
  return {
    notNull: types.has('CONSTR_NOTNULL') || types.has('CONSTR_PRIMARY'),
    hasDefault: types.has('CONSTR_DEFAULT') || types.has('CONSTR_IDENTITY') || types.has('CONSTR_GENERATED'),
    constraints,
  };
};

const indexKeyColumns = (indexParams) => (indexParams ?? []).map((param) => param.IndexElem?.name ?? null);

/** A unique key the previous release can never violate: at least one key column was
 *  added by this migration as nullable with no default (its writes leave it NULL, and
 *  NULLs never collide unless NULLS NOT DISTINCT), and every key is a plain column. */
const safeUniqueKeys = (table, columns, nullsNotDistinct, state) =>
  !nullsNotDistinct &&
  columns.length > 0 &&
  columns.every((column) => column !== null) &&
  columns.some((column) => state.nullableNewColumns.has(`${table}.${column}`));

const DATA_MODIFYING = new Set(['InsertStmt', 'UpdateStmt', 'DeleteStmt', 'MergeStmt']);
const modifiesDataInCte = (node) =>
  (node?.withClause?.WithClause ?? node?.withClause)?.ctes?.some((cte) => DATA_MODIFYING.has(nodeType(cte.CommonTableExpr?.ctequery)));

/** @returns {string[]} finding ids for one parsed statement (empty when expand-only). */
const classify = (stmt, state) => {
  const type = nodeType(stmt);
  const node = stmt[type] ?? {};
  if (modifiesDataInCte(node)) return ['data-change'];
  switch (type) {
    case 'TransactionStmt':
    case 'VariableSetStmt':
    case 'CommentStmt':
    case 'CreateEnumStmt':
    case 'CreateSeqStmt':
    case 'CreateSchemaStmt':
      return [];
    case 'CreateExtensionStmt':
      return node.if_not_exists ? [] : ['unknown'];
    case 'CreateStmt':
      state.createdTables.add(qualified(node.relation));
      return [];
    case 'CreateTableAsStmt':
      state.createdTables.add(qualified(node.into?.rel));
      return [];
    case 'AlterEnumStmt':
      return node.oldVal ? ['rename'] : [];
    case 'IndexStmt': {
      if (!node.unique) return [];
      const table = qualified(node.relation);
      if (state.createdTables.has(table)) return [];
      return safeUniqueKeys(table, indexKeyColumns(node.indexParams), node.nulls_not_distinct, state) ? [] : ['tighten-constraint'];
    }
    case 'AlterTableStmt': {
      if (node.objtype !== 'OBJECT_TABLE') return ['unknown'];
      const table = qualified(node.relation);
      const isNewTable = state.createdTables.has(table);
      const findings = [];
      for (const entry of node.cmds ?? []) {
        const cmd = entry.AlterTableCmd ?? {};
        switch (cmd.subtype) {
          case 'AT_AddColumn': {
            const def = cmd.def?.ColumnDef;
            const traits = columnTraits(def);
            const column = `${table}.${def?.colname}`;
            if (!traits.notNull && !traits.hasDefault) state.nullableNewColumns.add(column);
            if (isNewTable) break;
            if (traits.notNull && !traits.hasDefault) findings.push('add-required-column');
            for (const constraint of traits.constraints) {
              if (constraint.contype === 'CONSTR_CHECK' || constraint.contype === 'CONSTR_EXCLUSION') findings.push('tighten-constraint');
              if (
                (constraint.contype === 'CONSTR_UNIQUE' || constraint.contype === 'CONSTR_PRIMARY') &&
                !safeUniqueKeys(table, [def?.colname], constraint.nulls_not_distinct, state)
              ) {
                findings.push('tighten-constraint');
              }
              // An inline REFERENCES on a brand-new column only checks values the new code writes.
            }
            break;
          }
          case 'AT_DropNotNull':
            break;
          case 'AT_ColumnDefault':
            if (!cmd.def && !isNewTable) findings.push('drop-default');
            break;
          case 'AT_AddConstraint': {
            if (isNewTable) break;
            const constraint = cmd.def?.Constraint ?? {};
            if (constraint.contype === 'CONSTR_FOREIGN') {
              const columns = (constraint.fk_attrs ?? []).map(stringOf);
              const onNewColumns = columns.length > 0 && columns.every((column) => state.nullableNewColumns.has(`${table}.${column}`));
              if (!onNewColumns) findings.push('tighten-constraint');
            } else if (constraint.contype === 'CONSTR_UNIQUE' || constraint.contype === 'CONSTR_PRIMARY') {
              const columns = (constraint.keys ?? []).map(stringOf).map((column) => column ?? null);
              if (constraint.indexname || !safeUniqueKeys(table, columns, constraint.nulls_not_distinct, state)) findings.push('tighten-constraint');
            } else {
              findings.push('tighten-constraint');
            }
            break;
          }
          case 'AT_SetNotNull':
            if (!isNewTable) findings.push('set-not-null');
            break;
          case 'AT_AlterColumnType':
            findings.push('retype');
            break;
          case 'AT_DropColumn':
            findings.push('drop');
            break;
          case 'AT_DropConstraint':
            findings.push('drop-constraint');
            break;
          case 'AT_ValidateConstraint':
            findings.push('validate-constraint');
            break;
          default:
            findings.push('unknown');
        }
      }
      return findings;
    }
    case 'InsertStmt':
      return node.withClause || !state.createdTables.has(qualified(node.relation)) ? ['data-change'] : [];
    case 'UpdateStmt':
    case 'DeleteStmt':
    case 'TruncateStmt':
    case 'MergeStmt':
      return ['data-change'];
    case 'DropStmt':
      return [node.removeType === 'OBJECT_INDEX' ? 'drop-constraint' : 'drop'];
    case 'RenameStmt':
      return ['rename'];
    case 'DoStmt':
    case 'CreateFunctionStmt':
    case 'CreateTrigStmt':
    case 'CallStmt':
    case 'SelectStmt':
    case 'RuleStmt':
    case 'ViewStmt':
      return ['unanalyzable'];
    default:
      return ['unknown'];
  }
};

const snippet = (sql, raw) => {
  const start = raw.stmt_location ?? 0;
  const text = raw.stmt_len ? sql.slice(start, start + raw.stmt_len) : sql.slice(start);
  return text.replace(/\s+/g, ' ').trim().slice(0, 160);
};

/** @returns {Promise<{ id: string, why: string, statement: string }[]>} Throws on unparseable SQL. */
export const findContractStatements = async (sql) => {
  const parsed = await parse(sql);
  const state = { createdTables: new Set(), nullableNewColumns: new Set() };
  const findings = [];
  for (const raw of parsed.stmts ?? []) {
    for (const id of new Set(classify(raw.stmt, state))) findings.push({ id, why: WHY[id], statement: snippet(sql, raw) });
  }
  return findings;
};

export const contractOptOut = (sql) => CONTRACT_MARKER.exec(sql)?.[1]?.trim() ?? null;

export const checkMigration = async (file, sql) => {
  const reason = contractOptOut(sql);
  try {
    const findings = await findContractStatements(sql);
    return { file, findings, reason, parseError: null, ok: findings.length === 0 || reason !== null };
  } catch (error) {
    return { file, findings: [], reason, parseError: error instanceof Error ? error.message : String(error), ok: false };
  }
};

const changedMigrations = (base) =>
  execFileSync('git', ['diff', '--name-only', '--diff-filter=AMR', `${base}...HEAD`, '--', MIGRATIONS_GLOB], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

const main = async () => {
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
    const result = await checkMigration(file, readFileSync(file, 'utf8'));
    if (result.parseError) {
      failed = true;
      console.error(`::error file=${file}::Migration could not be parsed as PostgreSQL: ${result.parseError}`);
      continue;
    }
    if (!result.findings.length) {
      console.log(`ok       ${file} (expand-only)`);
      continue;
    }
    if (result.ok) {
      console.log(`CONTRACT ${file}: opted out (${result.reason})`);
      for (const finding of result.findings) console.log(`         - ${finding.id}: ${finding.statement}`);
      continue;
    }
    failed = true;
    console.error(`::error file=${file}::Migration is not provably expand-only.`);
    for (const finding of result.findings) console.error(`  - ${finding.id}: ${finding.why}\n      ${finding.statement}`);
  }
  if (failed) {
    console.error(
      '\nRolling deploys run the previous release against the new schema. Split this into an expand migration now and a contract ' +
        'migration in a later release, or add `-- nibleaf-migration: contract <reason>` and follow operations/runbook-rolling-deploys.md §4.',
    );
    process.exit(1);
  }
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
