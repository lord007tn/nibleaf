import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ member: vi.fn(), send: vi.fn() }));
vi.mock('@nibleaf/database', () => ({ prisma: { member: { findFirst: mocks.member } } }));
vi.mock('@/env', () => ({ env: { SMTP_URL: 'smtp://localhost', EMAIL_FROM: 'test@nibleaf.test', EMAIL_DELIVERY_REQUIRED: true } }));
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: mocks.send }) } }));

import { handleEmailJobs } from './email';

describe('queued team event email', () => {
  const job = {
    data: {
      to: 'reader@nibleaf.test',
      subject: 'Synthetic',
      html: '',
      teamAccess: { userId: 'user', projectId: 'project', minimumRole: 'admin', notificationId: 'project_deploy' },
    },
    timestamp: Date.now(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.send.mockResolvedValue({ messageId: 'synthetic' });
  });

  it('suppresses mail after access is removed, demoted or the account is disabled', async () => {
    mocks.member.mockResolvedValue(null);
    expect(await handleEmailJobs(job as never)).toEqual({ sent: false });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.member).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user',
          user: { email: 'reader@nibleaf.test', banned: false, suspendedAt: null },
          organization: { projects: { some: { id: 'project' } } },
          OR: [{ orgRole: { in: ['owner', 'admin'] } }, { orgRole: 'member', projectGrants: { some: { projectId: 'project', role: 'admin' } } }],
        }),
      }),
    );
  });

  it('honors the current personal email toggle at send time', async () => {
    mocks.member.mockResolvedValue({ user: { preference: { notifications: { project_deploy: false } } } });
    expect(await handleEmailJobs(job as never)).toEqual({ sent: false });
    expect(mocks.send).not.toHaveBeenCalled();
    mocks.member.mockResolvedValue({ user: { preference: { notifications: { project_deploy: true } } } });
    expect(await handleEmailJobs(job as never)).toEqual({ sent: true });
    expect(mocks.send).toHaveBeenCalledOnce();
  });
});
