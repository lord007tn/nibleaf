import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function countArbitraryTextSizes(source) {
  return [...source.matchAll(/\btext-\[\d+(?:\.\d+)?(?:px|rem)\]/g)].length;
}

/** Missing baseline entries have a zero allowance; updates can only lower it. */
export function compareTypeScale(current, baseline) {
  const violations = [];
  const nextBaseline = {};
  for (const [file, count] of Object.entries(current).sort(([a], [b]) => a.localeCompare(b))) {
    const allowed = baseline[file] ?? 0;
    if (file.startsWith('src/features/') && count > 0) {
      violations.push(`${file}: ${count} arbitrary text sizes (features must have zero)`);
    } else if (count > allowed) {
      violations.push(`${file}: ${count} arbitrary text sizes (baseline ${allowed})`);
    }
    const lowered = Math.min(count, allowed);
    if (lowered > 0) nextBaseline[file] = lowered;
  }
  return { violations, nextBaseline };
}

function collectCounts(directory, appRoot, counts) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) collectCounts(file, appRoot, counts);
    else if (entry.isFile() && entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) {
      counts[relative(appRoot, file).replaceAll('\\', '/')] = countArbitraryTextSizes(readFileSync(file, 'utf8'));
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--init', '--update'].includes(arg)) || (args.includes('--init') && args.includes('--update'))) {
    throw new Error('Usage: node scripts/check-type-scale.mjs [--update | --init (first run only)]');
  }
  const appRoot = fileURLToPath(new URL('../', import.meta.url));
  const baselinePath = fileURLToPath(new URL('./type-scale-baseline.json', import.meta.url));
  const current = {};
  for (const directory of ['features', 'components/project-settings', 'components/settings', 'routes/app/projects']) {
    collectCounts(join(appRoot, 'src', directory), appRoot, current);
  }
  // --init is for the first baseline only; exclusive creation prevents ratchet resets.
  if (args.includes('--init')) writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`, { flag: 'wx' });
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const { violations, nextBaseline } = compareTypeScale(current, baseline);
  if (args.includes('--update')) writeFileSync(baselinePath, `${JSON.stringify(nextBaseline, null, 2)}\n`);
  for (const violation of violations) console.error(violation);
  const total = Object.values(current).reduce((sum, count) => sum + count, 0);
  console.log(`Type scale: ${Object.keys(current).length} files, ${total} arbitrary text sizes, ${violations.length} violations.`);
  if (violations.length > 0) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
