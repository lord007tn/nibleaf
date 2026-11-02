import { createServer, type Socket } from 'node:net';
import type { SendEmailJobData } from '@nibleaf/bullmq/jobs/email';
import type { Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: {
    POSTMARK_API_KEY: undefined,
    POSTMARK_MESSAGE_STREAM: undefined,
    SMTP_URL: '',
    EMAIL_DELIVERY_REQUIRED: true,
    EMAIL_FROM: 'Nibleaf QA <sender@example.test>',
  },
  log: { info: vi.fn(), error: vi.fn() },
}));

vi.mock('@/env', () => ({ env: mocks.env }));
vi.mock('@nibleaf/logger', () => ({ createLogger: () => mocks.log }));

import { handleEmailJobs } from './email';

const job = {
  id: 'local-smtp-job',
  data: {
    to: 'Local Recipient <recipient@example.test>',
    subject: 'SMTP compatibility check',
    html: '<p>Hello from SMTP fixture</p>',
    text: 'Hello from SMTP fixture',
  },
} as Job<SendEmailJobData>;

async function localSmtp(rejectRecipient = false) {
  const sockets = new Set<Socket>();
  const received = { authentication: '', sender: '', recipient: '', message: '' };
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.setEncoding('utf8');
    let buffered = '';
    let readingMessage = false;
    socket.write('220 localhost SMTP fixture\r\n');
    socket.on('data', (chunk) => {
      buffered += chunk;
      let newline = buffered.indexOf('\r\n');
      while (newline !== -1) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 2);
        if (readingMessage) {
          if (line === '.') {
            readingMessage = false;
            socket.write('250 Message accepted\r\n');
          } else {
            received.message += `${line}\r\n`;
          }
        } else if (line.startsWith('EHLO ')) {
          socket.write('250-localhost\r\n250 AUTH PLAIN\r\n');
        } else if (line.startsWith('AUTH PLAIN ')) {
          received.authentication = Buffer.from(line.slice(11), 'base64').toString('utf8');
          socket.write('235 Authenticated\r\n');
        } else if (line.startsWith('MAIL FROM:')) {
          received.sender = line;
          socket.write('250 Sender accepted\r\n');
        } else if (line.startsWith('RCPT TO:')) {
          received.recipient = line;
          socket.write(rejectRecipient ? '550 Recipient rejected\r\n' : '250 Recipient accepted\r\n');
        } else if (line === 'DATA') {
          readingMessage = true;
          socket.write('354 End with a single dot\r\n');
        } else if (line === 'QUIT') {
          socket.end('221 Bye\r\n');
        } else {
          socket.write('500 Unsupported fixture command\r\n');
        }
        newline = buffered.indexOf('\r\n');
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected the SMTP fixture to bind a local TCP port');
  }
  return {
    url: `smtp://fixture-user:fixture-password@127.0.0.1:${address.port}?ignoreTLS=true`,
    received,
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

describe('SMTP delivery with the installed Nodemailer runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('authenticates from an SMTP URL and delivers the worker message to a loopback server', async () => {
    const smtp = await localSmtp();
    mocks.env.SMTP_URL = smtp.url;
    try {
      await expect(handleEmailJobs(job)).resolves.toEqual({ sent: true });
      expect(smtp.received.authentication).toBe('\0fixture-user\0fixture-password');
      expect(smtp.received.sender).toBe('MAIL FROM:<sender@example.test>');
      expect(smtp.received.recipient).toBe('RCPT TO:<recipient@example.test>');
      expect(smtp.received.message).toContain(`Subject: ${job.data.subject}`);
      expect(smtp.received.message).toContain('Content-Type: multipart/alternative;');
      expect(smtp.received.message).toContain(job.data.html);
      expect(smtp.received.message).toContain(job.data.text);
      expect(mocks.log.error).not.toHaveBeenCalled();
    } finally {
      await smtp.close();
    }
  });

  it('rejects a real SMTP refusal so the queue can retry without reporting success', async () => {
    const smtp = await localSmtp(true);
    mocks.env.SMTP_URL = smtp.url;
    try {
      await expect(handleEmailJobs(job)).rejects.toMatchObject({ code: 'EENVELOPE', responseCode: 550 });
      expect(smtp.received.message).toBe('');
      expect(mocks.log.info).not.toHaveBeenCalled();
      expect(mocks.log.error).toHaveBeenCalledWith({ jobId: job.id, provider: 'smtp' }, 'email delivery failed');
    } finally {
      await smtp.close();
    }
  });
});
