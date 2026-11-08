import { expect, it } from 'vitest';
import { LruCache } from './lru';

it('evicts least-recently-used values by total weight, including replacements and deletes', () => {
  const cache = new LruCache<string, number>(10, (weight) => weight);
  cache.set('a', 4);
  cache.set('b', 4);
  cache.get('a');
  cache.set('c', 4);
  expect([...cache.keys()]).toEqual(['a', 'c']);
  cache.set('a', 7);
  expect([...cache.keys()]).toEqual(['a']);
  cache.delete('a');
  cache.set('b', 10);
  expect(cache.get('b')).toBe(10);
  cache.clear();
  cache.set('c', 10);
  expect(cache.get('c')).toBe(10);
  expect(cache.canAdmit(11)).toBe(false);
  expect(cache.set('too-large', 11)).toBe(false);
  expect(cache.set('c', 11)).toBe(false);
  expect(cache.get('c')).toBe(10);
  expect(cache.size).toBe(1);
});

it('preserves the entry-count limit when no weight function is supplied', () => {
  const cache = new LruCache<string, string>(2);
  cache.set('a', 'long value');
  cache.set('b', 'other value');
  cache.set('c', 'third value');
  expect([...cache.keys()]).toEqual(['b', 'c']);
});
