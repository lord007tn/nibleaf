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

  it('reports the last draft sent while any write is pending (#728)', async () => {
    const first = deferred();
    const second = deferred();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const queue = createEditorSaveQueue(save);
    expect(queue.pendingDraft()).toBeUndefined();
    const older = queue.save(draft('older'));
    expect(queue.pendingDraft()?.content).toBe('older');
    const newer = queue.save(draft('newer'));
    expect(queue.pendingDraft()?.content).toBe('newer');
    first.reject(new Error('Network error'));
    await expect(older).rejects.toThrow('Network error');
    expect(queue.pendingDraft()?.content).toBe('newer');
    second.resolve('saved');
    await newer;
    expect(queue.pendingDraft()).toBeUndefined();
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

  describe('#735: one write per distinct pending text', () => {
    it('a draft whose text the pending write already carries, from a newer base, is not sent again', async () => {
      const first = deferred();
      const second = deferred();
      const save = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockResolvedValue('later');
      const queue = createEditorSaveQueue(save);
      const typed = queue.save({ ...draft('original+A'), expectedUpdatedAt: 'r0' });
      const undone = queue.save({ ...draft('original'), expectedUpdatedAt: 'r0' });
      first.resolve('r1');
      await typed;
      const again = queue.save({ ...draft('original'), expectedUpdatedAt: 'r1' });
      expect(queue.pendingDraft()).toMatchObject({ content: 'original', expectedUpdatedAt: 'r1' });
      second.resolve('r2');
      await expect(undone).resolves.toBe('r2');
      await expect(again).resolves.toBe('r2');
      expect(save.mock.calls.map(([value]) => value.content)).toEqual(['original+A', 'original']);
      expect(queue.hasPending()).toBe(false);
    });

    it('the pending write fails: the same text is sent in its place, after it', async () => {
      const first = deferred();
      const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue('stored');
      const queue = createEditorSaveQueue(save);
      const failing = queue.save({ ...draft('original'), expectedUpdatedAt: 'r0' });
      const again = queue.save({ ...draft('original'), expectedUpdatedAt: 'r1' });
      for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
      expect(save).toHaveBeenCalledOnce();
      first.reject(new Error('Network error'));
      await expect(failing).rejects.toThrow('Network error');
      await expect(again).resolves.toBe('stored');
      expect(save.mock.calls.map(([value]) => [value.content, value.expectedUpdatedAt])).toEqual([
        ['original', 'r0'],
        ['original', 'r1'],
      ]);
    });

    it('a revision conflict on the pending write still blocks the same text', async () => {
      const conflict = Object.assign(new Error('Revision conflict'), { code: 'page:revision_conflict', status: 409 });
      const save = vi.fn().mockRejectedValueOnce(conflict).mockResolvedValue('saved');
      const queue = createEditorSaveQueue(save);
      const pending = queue.save({ ...draft('text'), expectedUpdatedAt: 'r0' });
      const again = queue.save({ ...draft('text'), expectedUpdatedAt: 'r1' });
      await expect(pending).rejects.toBe(conflict);
      await expect(again).rejects.toBe(conflict);
      expect(save).toHaveBeenCalledOnce();
    });

    it.each<[string, PageDraft]>([
      ['different content', { ...draft('original+B'), expectedUpdatedAt: 'r1' }],
      ['a different title', { ...draft('original'), title: 'Renamed', expectedUpdatedAt: 'r1' }],
      ['the same text on another page', { ...draft('original', 'page-b'), expectedUpdatedAt: 'r1' }],
    ])('%s is always sent', async (_name, next) => {
      const first = deferred();
      const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue('saved');
      const queue = createEditorSaveQueue(save);
      const pending = queue.save({ ...draft('original'), expectedUpdatedAt: 'r0' });
      const queued = queue.save(next);
      first.resolve('saved');
      await Promise.all([pending, queued]);
      expect(save.mock.calls.map(([value]) => [value.id, value.title, value.content])).toEqual([
        ['page-a', 'Title', 'original'],
        [next.id, next.title, next.content],
      ]);
    });

    it('only the last pending write counts: an older one with the same text does not hide a newer draft', async () => {
      const first = deferred();
      const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue('saved');
      const queue = createEditorSaveQueue(save);
      const older = queue.save({ ...draft('original'), expectedUpdatedAt: 'r0' });
      const typed = queue.save({ ...draft('original+A'), expectedUpdatedAt: 'r0' });
      const undone = queue.save({ ...draft('original'), expectedUpdatedAt: 'r1' });
      first.resolve('saved');
      await Promise.all([older, typed, undone]);
      expect(save.mock.calls.map(([value]) => value.content)).toEqual(['original', 'original+A', 'original']);
    });
  });
});
