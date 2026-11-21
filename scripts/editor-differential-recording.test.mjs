import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const editor = new URL('../apps/app/src/components/editor/', import.meta.url);
const modes = [
  ['lf-main', ['WRITE_LF_MAIN']],
  ['expression-shapes-main', ['WRITE_EXPRESSION_SHAPES_MAIN']],
  ['attribute-blank-line-main', ['WRITE_BLANK_LINE_MAIN']],
  ['frame-main', ['WRITE_NON_FRAME_MAIN', 'WRITE_NON_FRAME_714_MAIN']],
];
const sourceOf = (name) => readFileSync(new URL(`${name}-differential.test.ts`, editor), 'utf8');

// Execute the actual recording/comparison tail, leaving expensive editor/corpus
// generation to the real differential suites. Fixture I/O stays entirely in memory.
function comparisonTail(name) {
  const source = sourceOf(name);
  const start = source.search(/^ {4}if \(process\.env\.WRITE_/m);
  const end = source.indexOf('\n  },', start);
  assert.ok(start >= 0 && end > start, `No recording/comparison callback found in ${name}`);
  return `(async () => { ${source.slice(start, end)} })()`;
}

const expect = (actual) => ({
  toBe: (expected) => assert.equal(actual, expected),
  toEqual: (expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected))),
  toHaveLength: (expected) => assert.equal(actual.length, expected),
});

function harness(env = {}, differing = 14) {
  const count = Math.max(14, differing);
  const main = Array.from({ length: count }, (_, index) => `main-${index}`);
  const outputs = main.map((value, index) => (index < differing ? `head-${index}` : value));
  const files = new Map([
    ['fixture', JSON.stringify({ pages: count, digests: main, seed: 1, sources: 'sources', outputs: main })],
    ['fixture714', JSON.stringify({ pages: count, records: [] })],
  ]);
  const writes = [];
  return {
    writes,
    context: {
      process: { env },
      console: { info: () => undefined },
      FIXTURE: 'fixture',
      FIXTURE_714: 'fixture714',
      readFileSync: (path) => {
        assert.ok(files.has(path), `Unexpected fixture read: ${path}`);
        return files.get(path);
      },
      writeFileSync: (path, text) => {
        files.set(path, text);
        writes.push(path);
      },
      expect,
      pages: main.map((_, index) => ({ page: String(index), edits: [] })),
      digests: outputs,
      results: [],
      crPages: [],
      CORPUS_START: 0,
      CODE_TOGGLE_KEEPS_LINK_PAGES: Array.from({ length: 14 }, (_, index) => index),
      // #604: no list item lead or loosened list pages in the synthetic fixture.
      LIST_ITEM_LEAD_PAGES: [],
      leadSources: new Set(),
      LOOSENED_LIST_PAGES: {},
      saveRecord: () => '',
      digest: (page) => `main-${page}`,
      SERIALIZER_CORPUS_SEED: 1,
      SERIALIZER_CORPUS_SIZE: count,
      sources: 'sources',
      cases: main,
      saveAll: async (_module, indexes) => (indexes ? indexes.map((index) => main[index]) : outputs),
      importEditor: async () => ({}),
      pathToFileURL: (path) => ({ href: path }),
      join: (...parts) => parts.join('/'),
    },
  };
}

const execute = (body, context) =>
  new vm.Script(stripTypeScriptTypes(body.replaceAll('await import(', 'await importEditor('))).runInNewContext(context);

test('every differential recording flag has a recording-mode regression case', () => {
  const flags = readdirSync(editor)
    .filter((name) => name.endsWith('-differential.test.ts'))
    .flatMap((name) =>
      [...readFileSync(new URL(name, editor), 'utf8').matchAll(/process\.env\.(WRITE_\w+|SERIALIZER_BASELINE_DIR)\b/g)].map((match) => match[1]),
    );
  assert.deepEqual([...new Set(flags)].sort(), [...modes.flatMap(([, flags]) => flags), 'SERIALIZER_BASELINE_DIR'].sort());
});

for (const [name, flags] of modes) {
  const body = comparisonTail(name);
  const combinations = flags.length === 1 ? [flags] : [[flags[0]], [flags[1]], flags];
  for (const active of combinations) {
    test(`${name}: ${active.join(' + ')} records without comparing exceptions`, async () => {
      const { context, writes } = harness(Object.fromEntries(active.map((flag) => [flag, '1'])));
      context.expect = () => assert.fail('Recording reached a fixture comparison assertion');
      // These cases only need recording I/O; no real corpus or fixture is evaluated.
      context.pages = [];
      context.digests = [];
      context.readFileSync = () => JSON.stringify({ pages: 0, digests: [] });
      await execute(body, context);
      assert.deepEqual(
        writes,
        active.map((flag) => (flag === 'WRITE_NON_FRAME_714_MAIN' ? 'fixture714' : 'fixture')),
      );
    });
  }
  test(`${name}: checking mode still runs fixture comparisons`, async () => {
    const { context, writes } = harness();
    context.expect = () => assert.fail('Fixture comparisons enabled');
    await assert.rejects(execute(body, context), /Fixture comparisons enabled/);
    assert.deepEqual(writes, []);
  });
}

for (const differing of [0, 13, 14, 15]) {
  test(`LF checking mode enforces the exact 14-page exception (${differing} differences)`, async () => {
    const { context, writes } = harness({}, differing);
    const result = execute(comparisonTail('lf-main'), context);
    if (differing === 14) await result;
    else await assert.rejects(result, assert.AssertionError);
    assert.deepEqual(writes, []);
  });
}

// The serializer already separates its record and check tests. Execute those
// registrations too, so recording must keep skipping the exception-checking test.
const serializer = sourceOf('serializer');
const serializerBody = serializer.slice(serializer.indexOf('const baselineDir ='));
function serializerTests(context) {
  const selected = [];
  context.it = {
    runIf: (enabled) => (_name, run) => enabled && selected.push(run),
    skipIf: (disabled) => (_name, run) => !disabled && selected.push(run),
  };
  execute(serializerBody, context);
  assert.equal(selected.length, 1);
  return selected[0];
}

test('serializer recording selects only the writer, without checking exceptions', async () => {
  const { context, writes } = harness({ SERIALIZER_BASELINE_DIR: 'baseline' });
  context.expect = () => assert.fail('Recording reached a fixture comparison assertion');
  await serializerTests(context)();
  assert.deepEqual(writes, ['fixture']);
});

for (const differing of [0, 13, 14, 15]) {
  test(`serializer checking mode enforces the exact 14-page exception (${differing} differences)`, async () => {
    const { context, writes } = harness({}, differing);
    const run = serializerTests(context);
    if (differing === 14) await run();
    else await assert.rejects(run(), assert.AssertionError);
    assert.deepEqual(writes, []);
  });
}
