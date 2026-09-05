import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ project: vi.fn(), organization: vi.fn(), members: vi.fn(), insert: vi.fn(), enqueue: vi.fn(), render: vi.fn() }));
vi.mock('@nibleaf/database', () => ({
  prisma: {
    project: { findUnique: mocks.project },
    organization: { findUnique: mocks.organization },
    member: { findMany: mocks.members },
    notification: { createMany: mocks.insert },
  },
}));
vi.mock('@nibleaf/bullmq', () => ({ QueueNames: { EMAIL: 'email' }, createJob: mocks.enqueue }));
vi.mock('@nibleaf/email', () => ({ renderDeploymentEmail: mocks.render, resolveEmailLanguage: (locale: string) => locale }));

import { notifyDeployment } from './notify';

const options = { deploymentId: 'deployment-a', projectId: 'project-a', projectName: 'Fixture', version: 1, outcome: 'ready', locale: 'ar' } as const;

describe('deployment notification retry identity', () => {
  const rows = new Map<string, unknown>();
  const jobs = new Map<string, unknown>();
  beforeEach(() => {
    vi.resetAllMocks();
    rows.clear();
    jobs.clear();
    mocks.project.mockResolvedValue({ organizationId: 'org-a' });
    mocks.organization.mockResolvedValue({ metadata: null });
    mocks.members.mockImplementation(async ({ where }) =>
      where.role
        ? [{ user: { email: 'a@example.invalid' } }, { user: { email: 'b@example.invalid' } }]
        : [{ userId: 'a' }, { userId: 'b' }, { userId: 'member-only' }],
    );
    mocks.render.mockResolvedValue({ subject: 'Fixture', html: '<p>Fixture</p>', text: 'Fixture' });
    // Model database uniqueness and a retained queue job, without external mail.
    mocks.insert.mockImplementation(async ({ data, skipDuplicates }) => {
      for (const row of data) {
        const id = row.id ?? `generated-${rows.size}`;
        if (rows.has(id) && !skipDuplicates) throw new Error('duplicate notification');
        rows.set(id, row);
      }
    });
    mocks.enqueue.mockImplementation(async (_queue, payload, opts) => {
      jobs.set(opts?.jobId ?? `generated-${jobs.size}`, payload);
    });
  });

  it('uses one identity per deployment, outcome and recipient across concurrent retries', async () => {
    await Promise.all(Array.from({ length: 8 }, () => notifyDeployment(options)));
    expect(rows.size).toBe(3);
    expect(jobs.size).toBe(2);
    expect([...rows.keys(), ...jobs.keys()].every((id) => /^deployment-[a-f0-9]{64}$/.test(id))).toBe(true);
    await notifyDeployment({ ...options, outcome: 'failed' });
    await notifyDeployment({ ...options, deploymentId: 'deployment-b' });
    expect(rows.size).toBe(9);
    expect(jobs.size).toBe(6);
    expect(mocks.members).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'org-a', role: { in: ['owner', 'admin'] } } }));
    expect(mocks.render).toHaveBeenCalledWith(expect.objectContaining({ language: 'ar' }));
  });

  it('retries a missing recipient without gating on already delivered in-app rows or other email jobs', async () => {
    mocks.enqueue.mockRejectedValueOnce(new Error('queue unavailable'));
    await expect(notifyDeployment(options)).rejects.toThrow('notification delivery incomplete');
    expect(rows.size).toBe(3);
    expect(jobs.size).toBe(1);
    await notifyDeployment(options);
    expect(rows.size).toBe(3);
    expect(jobs.size).toBe(2);
  });

  it('repairs failed in-app inserts independently of email enqueue', async () => {
    mocks.insert.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(notifyDeployment(options)).rejects.toThrow('notification delivery incomplete');
    expect(jobs.size).toBe(2);
    await notifyDeployment(options);
    expect(rows.size).toBe(3);
    expect(jobs.size).toBe(2);
  });

  it('honors current outcome preferences even on retry and does not reserve suppressed IDs', async () => {
    mocks.organization.mockResolvedValue({ metadata: JSON.stringify({ notifications: { project_deploy: false } }) });
    await notifyDeployment(options);
    expect(rows.size).toBe(0);
    expect(jobs.size).toBe(0);
    await notifyDeployment({ ...options, outcome: 'failed' });
    expect(rows.size).toBe(3);
    mocks.organization.mockResolvedValue({ metadata: null });
    await notifyDeployment(options);
    expect(rows.size).toBe(6);
    expect(jobs.size).toBe(4);
  });

  it('deduplicates repeated addresses and leaves later new recipients eligible', async () => {
    mocks.members
      .mockResolvedValueOnce([{ userId: 'a' }])
      .mockResolvedValueOnce([{ user: { email: 'a@example.invalid' } }, { user: { email: 'a@example.invalid' } }]);
    await notifyDeployment(options);
    expect(jobs.size).toBe(1);
    await notifyDeployment(options);
    expect(rows.size).toBe(3);
    expect(jobs.size).toBe(2);
  });
});
