import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('./client', () => ({ getS3Client: () => ({ send: mocks.send }), getBucket: () => 'fixture' }));

import { imageDimensions, storedImageDimensions } from './index';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');

describe('best-effort image dimensions', () => {
  beforeEach(() => vi.resetAllMocks());

  it('reads known intrinsic dimensions and ignores unparseable image bytes', () => {
    expect(imageDimensions(png)).toEqual({ width: 1, height: 1 });
    expect(imageDimensions(new Uint8Array([1, 2, 3]))).toBeNull();
    const oversized = Buffer.from(png);
    oversized.writeUInt32BE(0xff_ff_ff_ff, 16);
    expect(imageDimensions(oversized)).toBeNull();
  });

  it('reserves the browser-oriented aspect ratio for an EXIF-rotated JPEG', () => {
    // EXIF orientation 6 (90 degrees), with a 13 x 9 SOF header.
    const jpeg = Buffer.from(
      'ffd8ffe1002245786966000049492a0008000000010012010300010000000600000000000000ffc00011080009000d03011100021100031100ffd9',
      'hex',
    );
    expect(imageDimensions(jpeg)).toEqual({ width: 9, height: 13 });
  });

  it('uses a bounded storage Range and closes the body', async () => {
    const body = Readable.from([png]);
    mocks.send.mockResolvedValue({ Body: body });
    await expect(storedImageDimensions('projects/p/assets/a.png')).resolves.toEqual({ width: 1, height: 1 });
    expect(mocks.send.mock.calls[0]?.[0].input).toEqual({ Bucket: 'fixture', Key: 'projects/p/assets/a.png', Range: 'bytes=0-262143' });
    expect(mocks.send.mock.calls[0]?.[1].abortSignal).toBeInstanceOf(AbortSignal);
    expect(body.destroyed).toBe(true);
  });

  it('bounds reads even if storage ignores Range', async () => {
    let reads = 0;
    const body = Readable.from(
      (async function* () {
        for (let n = 0; n < 100; n++) {
          reads++;
          yield Buffer.alloc(256 * 1024);
        }
      })(),
    );
    mocks.send.mockResolvedValue({ Body: body });
    await expect(storedImageDimensions('key')).resolves.toBeNull();
    expect(reads).toBeLessThan(4);
    expect(body.destroyed).toBe(true);
  });

  it('leaves dimensions unknown on storage failure or image-size failure', async () => {
    mocks.send.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(storedImageDimensions('key')).resolves.toBeNull();
    const body = Readable.from([Buffer.from('not an image')]);
    mocks.send.mockResolvedValueOnce({ Body: body });
    await expect(storedImageDimensions('key')).resolves.toBeNull();
    expect(body.destroyed).toBe(true);
  });
});
