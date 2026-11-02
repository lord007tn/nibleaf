import { describe, expect, it, vi } from 'vitest';
import { createEditorSaveQueue, type PageDraft } from './editor-save-queue';

const draft = (content: string, id = 'page-a'): PageDraft => ({ id, title: 'Title', content });
const deferred = () => {
  let resolve!: (value: string) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<string>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe('editor save queue', () => {
  it('waits for an older request before saving a newer draft or another page', async () => {
    const first = deferred();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue('saved');
    const queue = createEditorSaveQueue(save);
    const oldSave = queue.save(draft('older'));
    const newSave = queue.save(draft('newer'));
    const nextPage = queue.save(draft('other page', 'page-b'));
    expect(queue.hasPending()).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);
    first.resolve('saved');
    await Promise.all([oldSave, newSave, nextPage]);
    expect(queue.hasPending()).toBe(false);
    expect(save.mock.calls.map(([value]) => value.content)).toEqual(['older', 'newer', 'other page']);
  });

  it('shares a queued save when publish flushes the exact same draft', async () => {
    const save = vi.fn().mockResolvedValue('saved');
    const queue = createEditorSaveQueue(save);
    const autosave = queue.save(draft('latest'));
    expect(queue.save(draft('latest'))).toBe(autosave);
    await autosave;
    expect(save).toHaveBeenCalledOnce();
  });

  it('rejects failed flushes and permits retrying the same content', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('saved');
    const queue = createEditorSaveQueue(save);
    await expect(queue.save(draft(''))).rejects.toThrow('offline');
    await expect(queue.save(draft(''))).resolves.toBe('saved');
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('does not replay an old failed snapshot after newer content succeeds', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('saved');
    const queue = createEditorSaveQueue(save);
    const oldSave = queue.save(draft('old'));
    const newSave = queue.save(draft('new'));
    await expect(oldSave).rejects.toThrow('offline');
    await expect(newSave).resolves.toBe('saved');
    await queue.settled();
    expect(save.mock.calls.map(([value]) => value.content)).toEqual(['old', 'new']);
  });
});
