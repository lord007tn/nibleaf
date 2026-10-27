import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ deletePrefix: vi.fn(), projectFindUnique: vi.fn() }));

vi.mock('@nibleaf/storage', () => ({ deletePrefix: mocks.deletePrefix }));
vi.mock('@nibleaf/database', () => ({ prisma: { project: { findUnique: mocks.projectFindUnique } } }));

import { eraseProjectStorage } from './project-storage-erasure';

describe('project storage erasure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.projectFindUnique.mockResolvedValue(null);
    mocks.deletePrefix.mockResolvedValue(3);
  });

  it('deletes only the deleted project prefix', async () => {
    await expect(eraseProjectStorage('project-a')).resolves.toBe(3);
    expect(mocks.projectFindUnique).toHaveBeenCalledWith({ where: { id: 'project-a' }, select: { id: true } });
    expect(mocks.deletePrefix).toHaveBeenCalledExactlyOnceWith('projects/project-a/');
  });

  it('succeeds as a no-op when objects are already gone', async () => {
    mocks.deletePrefix.mockResolvedValue(0);
    await expect(eraseProjectStorage('project-a')).resolves.toBe(0);
  });

  it('retries while the project row still exists', async () => {
    mocks.projectFindUnique.mockResolvedValue({ id: 'project-a' });
    await expect(eraseProjectStorage('project-a')).rejects.toThrow('waits for relational deletion');
    expect(mocks.deletePrefix).not.toHaveBeenCalled();
  });

  it.each(['', 'a/b'])('rejects an id that would widen the prefix (%j)', async (projectId) => {
    await expect(eraseProjectStorage(projectId)).rejects.toBeInstanceOf(TypeError);
    expect(mocks.projectFindUnique).not.toHaveBeenCalled();
    expect(mocks.deletePrefix).not.toHaveBeenCalled();
  });

  it('propagates storage failures so the job retries', async () => {
    mocks.deletePrefix.mockRejectedValue(new Error('storage unavailable'));
    await expect(eraseProjectStorage('project-a')).rejects.toThrow('storage unavailable');
  });
});
