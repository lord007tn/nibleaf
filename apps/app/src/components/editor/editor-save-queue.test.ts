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
  it('rename conflict blocks queued stale saves without dropping unsaved drafts', async () => {
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
      expect.anything(),
    );
  });

  it('successful queued saves advance only their own base revision', async () => {
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
  it('a revision the callback acknowledges before it fails still moves queued drafts on (#757)', async () => {
    let queue: ReturnType<typeof createEditorSaveQueue<{ updatedAt: string }>> | undefined;
    const save = vi.fn(async (sent: PageDraft) => {
      if (sent.content !== 'normalized') return { updatedAt: `after-${sent.expectedUpdatedAt}` };
      // Stored as other text at revision-2; sent again from it, and that fails.
      queue?.acknowledge(sent.id, sent.expectedUpdatedAt, 'revision-2');
      throw new Error('Network error');
    });
    queue = createEditorSaveQueue<{ updatedAt: string }>(save, (value) => value.updatedAt);
    const base = { ...draft('normalized'), expectedUpdatedAt: 'revision-1' };
    const failed = queue.save(base);
    // Queued while the retry runs, from either revision the editor knew.
    const queued = queue.save({ ...base, content: 'newer' });
    await expect(failed).rejects.toThrow('Network error');
    await queued;
    await queue.save({ ...base, content: 'next', expectedUpdatedAt: 'revision-2' });
    expect(save.mock.calls.map(([sent]) => [sent.content, sent.expectedUpdatedAt])).toEqual([
      ['normalized', 'revision-1'],
      ['newer', 'revision-2'],
      ['next', 'after-revision-2'],
    ]);
  });

  it('a revision the callback acknowledges before it succeeds is kept as a base (#757)', async () => {
    let queue: ReturnType<typeof createEditorSaveQueue<{ updatedAt: string }>> | undefined;
    const save = vi.fn(async (sent: PageDraft) => {
      if (sent.content === 'normalized') queue?.acknowledge(sent.id, sent.expectedUpdatedAt, 'revision-2');
      return { updatedAt: sent.content === 'normalized' ? 'revision-3' : 'revision-4' };
    });
    queue = createEditorSaveQueue<{ updatedAt: string }>(save, (value) => value.updatedAt);
    await queue.save({ ...draft('normalized'), expectedUpdatedAt: 'revision-1' });
    // A draft read while the retry ran, from the revision acknowledged in between.
    await queue.save({ ...draft('typed meanwhile'), expectedUpdatedAt: 'revision-2' });
    expect(save.mock.calls[1]?.[0]).toMatchObject({ expectedUpdatedAt: 'revision-3' });
  });

  it('knows the revisions its stored writes were sent from as superseded, not the latest or another page (#757)', async () => {
    const save = vi.fn().mockResolvedValueOnce({ updatedAt: 'revision-2' }).mockResolvedValue({ updatedAt: 'revision-3' });
    const queue = createEditorSaveQueue<{ updatedAt: string }>(save, (value) => value.updatedAt);
    await queue.save({ ...draft('one'), expectedUpdatedAt: 'revision-1' });
    await queue.save({ ...draft('two'), expectedUpdatedAt: 'revision-2' });
    expect(['revision-1', 'revision-2', 'revision-3', 'foreign'].map((revision) => queue.superseded('page-a', revision))).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(queue.superseded('page-b', 'revision-1')).toBe(false);
    queue.resolveConflict('page-a', 'reviewed');
    expect(queue.superseded('page-a', 'revision-1')).toBe(false);
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

describe('conflicts the editor found, and resolutions (#789, #790)', () => {
  const conflict = Object.assign(new Error('Another client saved this page.'), { code: 'page:revision_conflict' });

  it("refuses the page's writes with a raised conflict, without sending them, until it is resolved", async () => {
    const save = vi.fn().mockResolvedValue('saved');
    const queue = createEditorSaveQueue(save);
    queue.raiseConflict('page-a', conflict);
    await expect(queue.save(draft('mine'))).rejects.toBe(conflict);
    await queue.save(draft('other page', 'page-b'));
    expect(save).toHaveBeenCalledOnce();
    queue.resolveConflict('page-a', 'reviewed');
    await queue.save(draft('mine'));
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'page-a', expectedUpdatedAt: 'reviewed' }), expect.anything());
  });

  it('a write queued before a resolution is not sent after it', async () => {
    const first = deferred();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue('saved');
    const queue = createEditorSaveQueue(save);
    const inFlight = queue.save(draft('A'));
    const queued = queue.save(draft('AB'));
    const refused = expect(queued).rejects.toMatchObject({ code: 'page:write_superseded' });
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    queue.resolveConflict('page-a', 'reviewed');
    first.resolve('saved');
    await inFlight;
    await refused;
    expect(save).toHaveBeenCalledOnce();
    expect(queue.resolution('page-a')).toBe(1);
  });

  it('a 409 for a write sent before a resolution does not latch the conflict again', async () => {
    const first = deferred();
    const save = vi
      .fn()
      .mockReturnValueOnce(first.promise.then(() => Promise.reject(conflict)))
      .mockResolvedValue('saved');
    const queue = createEditorSaveQueue(save);
    const inFlight = queue.save(draft('A'));
    const refused = expect(inFlight).rejects.toBe(conflict);
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    queue.resolveConflict('page-a', 'reviewed');
    first.resolve('');
    await refused;
    const write = save.mock.calls[0]?.[1] as { stale: () => boolean } | undefined;
    expect(write?.stale()).toBe(true);
    await queue.save({ ...draft('mine'), expectedUpdatedAt: 'reviewed' });
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('tells which writes at the server carry a text, and which are in flight; a draft only queued carries nothing (#790)', async () => {
    const first = deferred();
    const queue = createEditorSaveQueue(vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue('saved'));
    const inFlight = queue.save(draft('A'));
    const queued = queue.save(draft('AB'));
    await vi.waitFor(() => expect(queue.inFlight('page-a')).toBe(true));
    expect(queue.carries('page-a', { title: 'Title', content: 'A' })).toBe(true);
    expect(queue.carries('page-a', { title: 'Title', content: 'AB' })).toBe(false);
    expect(queue.carries('page-b', { title: 'Title', content: 'A' })).toBe(false);
    expect(queue.inFlight('page-b')).toBe(false);
    first.resolve('saved');
    await Promise.all([inFlight, queued]);
    expect(queue.carries('page-a', { title: 'Title', content: 'AB' })).toBe(false);
    expect(queue.inFlight('page-a')).toBe(false);
  });

  it('reports the revision a draft is sent from: the latest own stored one, when based on one', async () => {
    const save = vi.fn().mockResolvedValue({ updatedAt: 'r2' });
    const queue = createEditorSaveQueue<{ updatedAt: string }>(save, (saved) => saved.updatedAt);
    await queue.save({ ...draft('A'), expectedUpdatedAt: 'r1' });
    expect(queue.baseFor({ ...draft('AB'), expectedUpdatedAt: 'r1' })).toBe('r2');
    expect(queue.baseFor({ ...draft('AB'), expectedUpdatedAt: 'foreign' })).toBe('foreign');
  });

  it('sentWrites: the writes of a page at the server, each with the revision it was sent from, and none once settled (#825)', async () => {
    const first = deferred();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue('r2');
    const queue = createEditorSaveQueue(save, (saved: string) => saved);
    const typed = queue.save({ ...draft('A'), expectedUpdatedAt: 'r0' });
    void queue.save({ ...draft('AB'), expectedUpdatedAt: 'r0' });
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    // A queued draft is not at the server.
    expect(queue.sentWrites('page-a')).toEqual([{ title: 'Title', content: 'A', base: 'r0' }]);
    expect(queue.sentWrites('page-b')).toEqual([]);
    first.resolve('r1');
    await typed;
    await queue.settled();
    expect(queue.sentWrites('page-a')).toEqual([]);
    // AB was sent from the revision A stored.
    expect(save.mock.calls[1]?.[0]).toMatchObject({ content: 'AB', expectedUpdatedAt: 'r1' });
  });
});
