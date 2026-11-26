import { describe, expect, it } from 'vitest';
import { aiPageNotice } from './page-notice';

const base = { availability: 'complete', failed: false, captureEnabled: true, captureOffReason: null };

describe('the Reader questions page shows one notice at most (WORKSPACE-02)', () => {
  it('replaces the page when the server keeps no history, even when saving is also off', () => {
    // Before: "not saved because history isn't set up" stacked on "history isn't available on this server".
    expect(aiPageNotice({ ...base, availability: 'disabled', captureEnabled: false, captureOffReason: 'instance' })).toEqual({ kind: 'unavailable' });
  });

  it('says a read failed before it talks about saving', () => {
    expect(aiPageNotice({ ...base, failed: true, captureEnabled: false })).toEqual({ kind: 'outage' });
    expect(aiPageNotice({ ...base, availability: 'unavailable' })).toEqual({ kind: 'outage' });
  });

  it('tells apart a site that turned saving off from history that is not on yet', () => {
    expect(aiPageNotice({ ...base, captureEnabled: false, captureOffReason: 'site' })).toEqual({ kind: 'notSaving', reason: 'site' });
    expect(aiPageNotice({ ...base, captureEnabled: false, captureOffReason: 'instance' })).toEqual({ kind: 'notSaving', reason: 'instance' });
  });

  it('shows nothing while working normally or still loading', () => {
    expect(aiPageNotice(base)).toBeNull();
    expect(aiPageNotice({ availability: undefined, failed: false, captureEnabled: undefined, captureOffReason: undefined })).toBeNull();
  });
});
