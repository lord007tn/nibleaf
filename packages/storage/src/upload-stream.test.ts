import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('./client', () => ({ getS3Client: () => ({ send: mocks.send }), getBucket: () => 'test' }));

import { MAX_PRESIGNED_UPLOAD_BYTES, putObjectStream } from './index';

const body = (...chunks: Uint8Array[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
beforeEach(() => {
  mocks.send.mockReset().mockImplementation(async (command, options) => {
    for await (const _chunk of command.input.Body) {
      /* consume as the transport does */
    }
    expect(options.abortSignal.aborted).toBe(false);
  });
});
it('streams exactly the reserved bytes through the internal client with signed metadata', async () => {
  await putObjectStream('key', body(new Uint8Array(2), new Uint8Array(1)), 3, 'image/png');
  expect(mocks.send.mock.calls[0]?.[0].input).toMatchObject({ Key: 'key', ContentLength: 3, ContentType: 'image/png' });
});
it('aborts an overrun before forwarding the excess chunk', async () => {
  await expect(putObjectStream('key', body(new Uint8Array(4)), 3, 'image/png')).rejects.toThrow('exceeds');
  expect(mocks.send.mock.calls[0]?.[1].abortSignal.aborted).toBe(true);
});
it('rejects truncated bodies and declarations above 50 MiB', async () => {
  await expect(putObjectStream('key', body(new Uint8Array(2)), 3, 'image/png')).rejects.toThrow('match');
  mocks.send.mockClear();
  await expect(putObjectStream('key', body(), MAX_PRESIGNED_UPLOAD_BYTES + 1, 'image/png')).rejects.toThrow('50 MiB');
  expect(mocks.send).not.toHaveBeenCalled();
});
it('does not accept an early storage response before validating the entire body', async () => {
  mocks.send.mockResolvedValue({});
  await expect(putObjectStream('key', body(new Uint8Array(3)), 3, 'image/png')).rejects.toThrow('before');
});
