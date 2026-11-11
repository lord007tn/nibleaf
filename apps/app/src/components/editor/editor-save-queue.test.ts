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
  it('council: rename conflict blocks queued stale saves without dropping unsaved drafts', async () => {
    const conflict = Object.assign(new Error('Revision conflict'), { code: 'page:revision_conflict', status: 409 });
    const save = vi.fn().mockRejectedValueOnce(conflict).mockResolvedValue('saved');
    const queue = createEditorSaveQueue(save);
    const original = { ...draft('[link](/old)\nUnsaved text'), expectedUpdatedAt: '2026-11-01T00:00:00Z' };
    const newer = { ...original, content: `${original.content}\nMore unsaved text` };
    const pending = queue.save(original);
    const queued = queue.save(newer);
    await expect(pending).rejects.toBe(conflict);
    await expect(queued).rejects.toBe(conflict);
    expect(save).toHaveBeenCalledOnce();
    expect(newer.content).toContain('More unsaved text');
    queue.resolveConflict(original.id, 'reviewed-revision');
    await queue.save({ ...newer, content: newer.content.replace('/old', '/new'), expectedUpdatedAt: 'reviewed-revision' });
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ content: '[link](/new)\nUnsaved text\nMore unsaved text', expectedUpdatedAt: 'reviewed-revision' }),
    );
  });

  it('council: successful queued saves advance only their own base revision', async () => {
    const save = vi.fn().mockResolvedValueOnce({ updatedAt: 'revision-2' }).mockResolvedValue({ updatedAt: 'revision-3' });
    const queue = createEditorSaveQueue<{ updatedAt: string }>(save, (value) => value.updatedAt);
    const base = { ...draft('one'), expectedUpdatedAt: 'revision-1' };
    await Promise.all([queue.save(base), queue.save({ ...base, content: 'two' })]);
    expect(save.mock.calls[1]?.[0]).toMatchObject({ expectedUpdatedAt: 'revision-2' });
    await queue.save({ ...base, content: 'fresh server base', expectedUpdatedAt: 'remote-revision' });
    expect(save.mock.calls[2]?.[0]).toMatchObject({ expectedUpdatedAt: 'remote-revision' });
    await queue.save({ ...base, content: 'stale queued text' });
    expect(save.mock.calls[3]?.[0]).toMatchObject({ expectedUpdatedAt: 'revision-1' });
  });
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
