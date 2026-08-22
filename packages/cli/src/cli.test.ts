import { expect, it } from 'vitest';
import { runCli } from './cli';

it('prints help and version without network access', async () => {
  const output: string[] = [];
  const errors: string[] = [];
  const io = { out: (value: string) => output.push(value), error: (value: string) => errors.push(value) };

  expect(await runCli(['--help'], io)).toBe(0);
  expect(output.join('\n')).toContain('nibleaf inspect');
  expect(await runCli(['--version'], io)).toBe(0);
  expect(output.at(-1)).toBe('0.1.0');
  expect(errors).toEqual([]);
});
