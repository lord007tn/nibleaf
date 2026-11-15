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
    /** A server that answers each write with what it stored and a new revision. */
    type Stored = { id: string; title: string; content: string; updatedAt: string };
    const held = () => {
      const writes: Array<{ draft: PageDraft; land: (stored?: Partial<Stored>) => void; fail: () => void }> = [];
      let revision = 0;
      const save = vi.fn(
        (sent: PageDraft) =>
          new Promise<Stored>((resolve, reject) => {
            writes.push({
              draft: sent,
              land: (stored) => {
                revision += 1;
                resolve({ id: sent.id, title: sent.title, content: sent.content, updatedAt: `r${revision}`, ...stored });
              },
              fail: () => reject(new Error('Network error')),
            });
          }),
      );
      const queue = createEditorSaveQueue<Stored>(
        save,
        (saved) => saved.updatedAt,
        (saved) => saved,
      );
      const settle = async (how: 'land' | 'fail' = 'land', stored?: Partial<Stored>) => {
        for (let tick = 0; tick < 10 && writes.length === 0; tick += 1) await Promise.resolve();
        const next = writes.shift();
        if (!next) throw new Error('No write is in flight');
        if (how === 'land') next.land(stored);
        else next.fail();
        for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
      };
      return { save, queue, settle, sent: () => save.mock.calls.map(([value]) => [value.content, value.expectedUpdatedAt]) };
    };

    it('a draft whose text the pending write carries, from a revision this queue produced, is not sent again once it lands as sent', async () => {
      const { queue, settle, sent } = held();
      const typed = queue.save({ ...draft('original+A'), expectedUpdatedAt: 'r0' });
      const undone = queue.save({ ...draft('original'), expectedUpdatedAt: 'r0' });
      await settle();
      await typed;
      // The `A` write produced r1; the next flush sends the undone text from it.
      const again = queue.save({ ...draft('original'), expectedUpdatedAt: 'r1' });
      expect(queue.pendingDraft()).toMatchObject({ content: 'original', expectedUpdatedAt: 'r1' });
      await settle();
      await expect(undone).resolves.toMatchObject({ content: 'original', updatedAt: 'r2' });
      await expect(again).resolves.toMatchObject({ content: 'original', updatedAt: 'r2' });
      expect(sent()).toEqual([
        ['original+A', 'r0'],
        ['original', 'r1'],
      ]);
      expect(queue.hasPending()).toBe(false);
    });

    it('a draft from a foreign server copy is sent, even with the text of the pending write', async () => {
      const { queue, settle, sent } = held();
      const typed = queue.save({ ...draft('original+A'), expectedUpdatedAt: 'r0' });
      // Another client's copy, at a revision this queue never produced.
      const adopted = queue.save({ ...draft('original+A'), expectedUpdatedAt: 'foreign-r9' });
      await settle();
      await settle();
      await Promise.all([typed, adopted]);
      expect(sent()).toEqual([
        ['original+A', 'r0'],
        ['original+A', 'foreign-r9'],
      ]);
    });

    it.each<[string, Partial<Stored>]>([
      ['other content (normalized)', { content: 'original\n' }],
      ['another title', { title: 'Renamed' }],
      ['another page', { id: 'page-b' }],
    ])('the pending write landed with %s: the draft is still sent, from the revision it produced', async (_name, stored) => {
      const { queue, settle, sent } = held();
      void queue.save({ ...draft('original+A'), expectedUpdatedAt: 'r0' });
      const undone = queue.save({ ...draft('original'), expectedUpdatedAt: 'r0' });
      await settle();
      const again = queue.save({ ...draft('original'), expectedUpdatedAt: 'r1' });
      await settle('land', stored);
      await undone;
      await settle();
      await expect(again).resolves.toMatchObject({ content: 'original', updatedAt: 'r3' });
      expect(sent()).toEqual([
        ['original+A', 'r0'],
        ['original', 'r1'],
        ['original', 'r2'],
      ]);
    });

    it('the pending write fails, then the draft sent in its place lands', async () => {
      const { queue, settle, sent } = held();
      void queue.save({ ...draft('original+A'), expectedUpdatedAt: 'r0' });
      const undone = queue.save({ ...draft('original'), expectedUpdatedAt: 'r0' });
      await settle();
      const again = queue.save({ ...draft('original'), expectedUpdatedAt: 'r1' });
      await settle('fail');
      await expect(undone).rejects.toThrow('Network error');
      await settle();
      await expect(again).resolves.toMatchObject({ content: 'original', updatedAt: 'r2' });
      expect(sent()).toEqual([
        ['original+A', 'r0'],
        ['original', 'r1'],
        ['original', 'r1'],
      ]);
    });

    it('without a way to read what the server stored, a repeat is always sent', async () => {
      const save = vi.fn().mockResolvedValue({ updatedAt: 'r1' });
      const queue = createEditorSaveQueue<{ updatedAt: string }>(save, (saved) => saved.updatedAt);
      const first = queue.save({ ...draft('original'), expectedUpdatedAt: 'r0' });
      const again = queue.save({ ...draft('original'), expectedUpdatedAt: 'r1' });
      await Promise.all([first, again]);
      expect(save).toHaveBeenCalledTimes(2);
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
