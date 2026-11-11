import { describe, expect, it } from 'vitest';
import { exceedsUtf8Bytes, MAX_PAGE_CONTENT_BYTES, oversizedPageContent } from './page-limits';

const MiB = 1024 * 1024;

describe('exceedsUtf8Bytes', () => {
  it('accepts exactly the limit and refuses one byte more', () => {
    expect(MAX_PAGE_CONTENT_BYTES).toBe(2 * MiB);
    expect(exceedsUtf8Bytes('x'.repeat(MAX_PAGE_CONTENT_BYTES), MAX_PAGE_CONTENT_BYTES)).toBe(false);
    expect(exceedsUtf8Bytes('x'.repeat(MAX_PAGE_CONTENT_BYTES + 1), MAX_PAGE_CONTENT_BYTES)).toBe(true);
  });

  it('counts multibyte text in UTF-8 bytes, not UTF-16 length', () => {
    // Arabic letters are two bytes each, emoji four (one surrogate pair).
    expect(exceedsUtf8Bytes('ع'.repeat(MAX_PAGE_CONTENT_BYTES / 2), MAX_PAGE_CONTENT_BYTES)).toBe(false);
    expect(exceedsUtf8Bytes(`${'ع'.repeat(MAX_PAGE_CONTENT_BYTES / 2)}x`, MAX_PAGE_CONTENT_BYTES)).toBe(true);
    expect(exceedsUtf8Bytes('😀'.repeat(MAX_PAGE_CONTENT_BYTES / 4), MAX_PAGE_CONTENT_BYTES)).toBe(false);
    expect(exceedsUtf8Bytes(`${'😀'.repeat(MAX_PAGE_CONTENT_BYTES / 4)}x`, MAX_PAGE_CONTENT_BYTES)).toBe(true);
    // Under the limit in UTF-16 code units, over it in bytes.
    expect(exceedsUtf8Bytes('ع'.repeat(MAX_PAGE_CONTENT_BYTES / 2 + 1), MAX_PAGE_CONTENT_BYTES)).toBe(true);
    expect(exceedsUtf8Bytes('\ud800', 2)).toBe(true);
    expect(exceedsUtf8Bytes('ع', 2)).toBe(false);
  });

  it('stops counting as soon as the limit is passed', () => {
    // Stands in for a string (its length and characters) and counts how many characters were read.
    const counted = (text: string) => {
      const read = { count: 0 };
      const value = {
        length: text.length,
        *[Symbol.iterator]() {
          for (const char of text) {
            read.count += 1;
            yield char;
          }
        },
      };
      return { value: value as unknown as string, read };
    };
    const arabic = counted('ع'.repeat(10_000));
    expect(exceedsUtf8Bytes(arabic.value, 15_000)).toBe(true);
    // 7,501 two-byte letters pass 15,000 bytes; the other 2,499 are never read.
    expect(arabic.read.count).toBe(7501);
    // Longer than the limit in code units: refused without reading any of it.
    const huge = counted('x'.repeat(64 * MiB));
    expect(exceedsUtf8Bytes(huge.value, MAX_PAGE_CONTENT_BYTES)).toBe(true);
    expect(huge.read.count).toBe(0);
  });
});

describe('oversizedPageContent', () => {
  const atCap = 'x'.repeat(MAX_PAGE_CONTENT_BYTES);
  const overCap = `${atCap}x`;

  it('allows any create or update at or under the cap', () => {
    expect(oversizedPageContent(atCap)).toBeNull();
    expect(oversizedPageContent(atCap, '')).toBeNull();
    expect(oversizedPageContent('ع'.repeat(MAX_PAGE_CONTENT_BYTES / 2), '')).toBeNull();
  });

  it('refuses a create over the cap with its size in bytes', () => {
    expect(oversizedPageContent(overCap)).toBe(MAX_PAGE_CONTENT_BYTES + 1);
    expect(oversizedPageContent('😀'.repeat(MAX_PAGE_CONTENT_BYTES / 4 + 1))).toBe(MAX_PAGE_CONTENT_BYTES + 4);
  });

  it('refuses an update over the cap that grows the stored body', () => {
    expect(oversizedPageContent(overCap, 'small')).toBe(MAX_PAGE_CONTENT_BYTES + 1);
    expect(oversizedPageContent('x'.repeat(3 * MiB + 1), 'x'.repeat(3 * MiB))).toBe(3 * MiB + 1);
    // Same UTF-16 length, more bytes: Arabic replacing ASCII grows the page.
    expect(oversizedPageContent('ع'.repeat(MiB + 1), 'x'.repeat(MiB + 1))).toBe(2 * MiB + 2);
  });

  it('never blocks an update that keeps or shrinks a body already over the cap', () => {
    expect(oversizedPageContent('x'.repeat(2.5 * MiB), 'x'.repeat(3 * MiB))).toBeNull();
    expect(oversizedPageContent('y'.repeat(3 * MiB), 'x'.repeat(3 * MiB))).toBeNull();
    // ASCII replacing Arabic: more characters, fewer bytes (2.5 MiB after, 3 MiB before).
    expect(oversizedPageContent('x'.repeat(2.5 * MiB), 'ع'.repeat(1.5 * MiB))).toBeNull();
  });
});
