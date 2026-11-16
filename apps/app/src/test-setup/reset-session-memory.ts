import { afterEach } from 'vitest';
import { notifySessionCleared } from '@/lib/session-cleared';

// In-memory account data (the editor's unsaved drafts) lives for the session, as
// a signed-in tab's would. Tests sharing a page and an account would otherwise
// inherit a draft an earlier test left unsaved: each test starts a new session.
afterEach(() => {
  notifySessionCleared();
});
