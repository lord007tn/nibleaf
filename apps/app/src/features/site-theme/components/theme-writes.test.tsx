// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireWrite, releaseWrite, subscribeWrites, useWriteFor, writeFor } from './theme-writes';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const A = '["site-a","theme"]';
const B = '["site-b","theme"]';
const held: Array<ReturnType<typeof acquireWrite>> = [];
const take = (identity: string, kind: 'save' | 'apply' = 'save') => {
  const owned = acquireWrite(identity, kind);
  held.push(owned);
  return owned;
};

afterEach(() => {
  for (const owned of held.splice(0)) if (owned) releaseWrite(owned);
});

describe('the per-site theme write turn', () => {
  it('one write per site at a time; another site is independent', () => {
    const save = take(A);
    expect(save).toStrictEqual({ kind: 'save', identity: A });
    expect(take(A, 'apply')).toBeNull();
    expect(take(B, 'apply')).toStrictEqual({ kind: 'apply', identity: B });
    expect(writeFor(A)).toBe(save);
  });

  it('a write gives back only its own turn: a stale release changes nothing and tells nobody', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWrites(listener);
    const first = take(A);
    if (!first) throw new Error('not taken');
    releaseWrite(first);
    const second = take(A);
    listener.mockClear();
    releaseWrite(first);
    expect(writeFor(A)).toBe(second);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('tells subscribers when a turn is taken and given back, and no longer after they unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWrites(listener);
    const owned = take(A);
    expect(listener).toHaveBeenCalledTimes(1);
    if (owned) releaseWrite(owned);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    take(A);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('a mounted form re-renders when its site’s write starts and ends, and stops listening once unmounted', async () => {
    const renders: Array<string | undefined> = [];
    function Probe({ identity }: { identity: string }) {
      renders.push(useWriteFor(identity)?.kind);
      return null;
    }
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => root.render(<Probe identity={A} />));
    const owned = await act(async () => take(A, 'apply'));
    // Another site's write is not this form's.
    await act(async () => {
      take(B);
    });
    if (owned) await act(async () => releaseWrite(owned));
    expect(renders).toStrictEqual([undefined, 'apply', undefined]);
    await act(async () => root.unmount());
    await act(async () => {
      take(A);
    });
    expect(renders).toHaveLength(3);
  });
});
