import { describe, expect, it } from 'vitest';
import type { Domain } from '@/hooks/api/types';
import {
  addDecision,
  addErrorTarget,
  CHECK_RESULT,
  checkFailureToasts,
  checkOutcome,
  cleanDomainInput,
  decisionProps,
  dnsRecordView,
  domainAccess,
  domainBadge,
  domainHref,
  domainInputProblem,
  domainRowActions,
  domainStage,
  isApexDomain,
  STAGES,
  setupDetails,
} from './domains';

const domain = (patch: Partial<Domain> = {}): Domain => ({
  id: 'd1',
  domain: 'docs.example.com',
  verified: false,
  isPrimary: false,
  dnsStatus: 'PENDING',
  sslStatus: 'PENDING',
  verificationToken: 'token',
  createdAt: '2026-11-01T00:00:00Z',
  verifiedAt: null,
  lastCheckedAt: null,
  lastError: null,
  records: [],
  ...patch,
});
const live = (patch: Partial<Domain> = {}) => domain({ verified: true, dnsStatus: 'VERIFIED', sslStatus: 'ACTIVE', ...patch });

describe('stages', () => {
  it.each([
    [{ dnsStatus: 'PENDING', sslStatus: 'PENDING' }, 'settings.domain.status.provisioning', 'pending'],
    [{ dnsStatus: 'ERROR', sslStatus: 'PENDING' }, 'settings.domain.status.dnsError', 'danger'],
    [{ dnsStatus: 'VERIFIED', sslStatus: 'PROVISIONING' }, 'settings.domain.status.sslProvisioning', 'pending'],
    [{ dnsStatus: 'VERIFIED', sslStatus: 'ERROR' }, 'settings.domain.status.sslError', 'danger'],
    [{ dnsStatus: 'VERIFIED', sslStatus: 'ACTIVE' }, 'settings.domain.status.verified', 'success'],
  ] as const)('%o → one label and tone', (status, label, tone) => {
    const row = domain(status);
    expect(domainBadge(domainStage(row), false)).toEqual({ label, tone });
  });

  it('says "Checking…" while that domain is being checked', () => {
    expect(domainBadge('live', true)).toEqual({ label: 'settings.domain.status.checking', tone: 'pending' });
  });

  it('explains every stage but live', () => {
    expect(
      Object.entries(STAGES)
        .filter(([, stage]) => !stage.help)
        .map(([name]) => name),
    ).toEqual(['live']);
  });
});

describe('checkOutcome', () => {
  it.each([
    [{ dnsStatus: 'VERIFIED', sslStatus: 'PROVISIONING' }, 'info', 'settings.domain.toast.provisioning'],
    [{ dnsStatus: 'VERIFIED', sslStatus: 'ACTIVE' }, 'success', 'settings.domain.toast.live'],
    [{ dnsStatus: 'PENDING', sslStatus: 'PENDING' }, 'info', 'settings.domain.toast.waiting'],
    [{ dnsStatus: 'VERIFIED', sslStatus: 'ERROR' }, 'error', 'settings.domain.toast.needsAttention'],
  ] as const)('reports the state the check found: %o', (result, kind, key) => {
    expect(checkOutcome(result)).toEqual({ toasts: [{ kind, key }], revealRecords: false });
  });

  it('says only that the main address was lost when a check demotes it', () => {
    expect(checkOutcome({ dnsStatus: 'VERIFIED', sslStatus: 'ERROR', demoted: true }).toasts).toEqual([
      { kind: 'warning', key: 'settings.domain.toast.demoted', withDomain: true },
    ]);
  });

  it('suggests adding back a removed TXT record on a live domain, and opens its records', () => {
    expect(checkOutcome({ dnsStatus: 'VERIFIED', sslStatus: 'ACTIVE', ownershipRecordMissing: true })).toEqual({
      toasts: [CHECK_RESULT.live, { kind: 'info', key: 'settings.domain.toast.txtMissing', withDomain: true }],
      revealRecords: true,
    });
  });

  it('names a demotion on a failed check, and nothing else', () => {
    expect(checkFailureToasts(true)).toEqual([{ kind: 'warning', key: 'settings.domain.toast.demoted', withDomain: true }]);
    expect(checkFailureToasts(false)).toEqual([]);
  });
});

describe('the add field', () => {
  it('connects the bare hostname when a full web address is pasted', () => {
    expect(cleanDomainInput('  HTTPS://Docs.Example.com/help/ ')).toEqual({ cleaned: 'docs.example.com', valid: true, apex: false });
  });

  it('never joins two words into a different domain', () => {
    expect(cleanDomainInput('docs example.com').valid).toBe(false);
    expect(domainInputProblem('docs example.com', 'edit')).toBe('invalid');
  });

  it('says nothing about an empty field until the person tries to add it', () => {
    expect(domainInputProblem('  ', 'edit')).toBeUndefined();
    expect(domainInputProblem('  ', 'submit')).toBe('invalid');
    expect(domainInputProblem('docs.example.com', 'submit')).toBeUndefined();
  });

  it('flags a root domain, which often cannot take a CNAME', () => {
    expect(isApexDomain('example.com')).toBe(true);
    expect(isApexDomain('example.co.uk')).toBe(true);
    expect(isApexDomain('docs.example.com')).toBe(false);
    expect(cleanDomainInput('example.com').apex).toBe(true);
    expect(cleanDomainInput('not a domain').apex).toBe(false);
  });

  it.each([
    ['validation:failed', 'field'],
    ['domain:already_added', 'field'],
    ['domain:already_connected', 'field'],
    ['domain:provider_failed', 'toast'],
    [undefined, 'toast'],
  ])('puts a %s refusal on the %s', (code, target) => {
    expect(addErrorTarget(code ? { code } : new Error('offline'))).toBe(target);
  });
});

describe('dnsRecordView', () => {
  it('gives the name relative to the zone, and the full name beside it', () => {
    expect(dnsRecordView({ type: 'TXT', name: '_nibleaf.docs.example.com.', value: 'v' }, 'docs.example.com')).toMatchObject({
      host: '_nibleaf.docs',
      fullName: '_nibleaf.docs.example.com',
      purpose: 'settings.domain.dns.purpose.txt',
    });
  });

  it('uses @ for the zone itself and marks the routing CNAME', () => {
    expect(dnsRecordView({ type: 'CNAME', name: 'example.com', value: 'cname.nibleaf.test' }, 'example.com')).toMatchObject({
      host: '@',
      purpose: 'settings.domain.dns.purpose.cname',
    });
    expect(dnsRecordView({ type: 'CNAME', name: 'docs.example.com', value: 'x' }, 'docs.example.com')).toMatchObject({
      host: 'docs',
      purpose: 'settings.domain.dns.purpose.cname',
    });
  });
});

describe('setupDetails', () => {
  const records = [{ type: 'CNAME', name: 'docs.example.com', value: 'x', ttl: 3600 }];

  it('opens the steps and records of a domain still being set up', () => {
    expect(setupDetails(domain({ records }))).toMatchObject({ hasDetails: true, openByDefault: true, hasRecords: true, showSteps: true });
  });

  it('folds a live domain’s records but keeps them, so a removed TXT record can be added back', () => {
    expect(setupDetails(live({ records, lastError: 'old' }))).toEqual({
      hasDetails: true,
      openByDefault: false,
      hasRecords: true,
      showSteps: false,
      apexHint: false,
      technicalError: null,
    });
  });

  it('shows no steps before there are records to follow', () => {
    expect(setupDetails(domain())).toMatchObject({ hasDetails: false, showSteps: false });
  });

  it('keeps the server’s wording and the root-domain hint for a domain not yet live', () => {
    expect(setupDetails(domain({ domain: 'example.com', lastError: 'TXT missing' }))).toMatchObject({
      hasDetails: true,
      apexHint: true,
      technicalError: 'TXT missing',
    });
  });
});

describe('domainHref', () => {
  it('links only a domain that serves the docs', () => {
    expect(domainHref(live())).toBe('https://docs.example.com');
    expect(domainHref(live({ verified: false }))).toBeNull();
    expect(domainHref(domain({ dnsStatus: 'VERIFIED', sslStatus: 'PROVISIONING', verified: true }))).toBeNull();
  });
});

describe('access', () => {
  it('lets admins manage, shows others a read-only section, and locks while unknown', () => {
    expect(domainAccess('admin')).toEqual({ canManage: true, readOnly: false, locked: false });
    expect(domainAccess('notAdmin')).toEqual({ canManage: false, readOnly: true, locked: false });
    expect(domainAccess('pending')).toEqual({ canManage: true, readOnly: false, locked: true });
    expect(addDecision('admin')).toEqual({ kind: 'allowed' });
    expect(addDecision('pending')).toEqual({ kind: 'locked' });
    expect(addDecision('notAdmin')).toBeNull();
  });
});

describe('domainRowActions', () => {
  it('offers nothing to non-admins', () => {
    expect(domainRowActions(live(), 'notAdmin')).toEqual({ check: null, setPrimary: null, remove: null });
  });

  it('locks every action, without a reason, while access is unknown', () => {
    expect(domainRowActions(live(), 'pending')).toEqual({ check: { kind: 'locked' }, setPrimary: { kind: 'locked' }, remove: { kind: 'locked' } });
    expect(domainRowActions(live({ isPrimary: true }), 'pending').setPrimary).toBeNull();
  });

  it('lets a live domain become the main address', () => {
    expect(domainRowActions(live(), 'admin')).toEqual({ check: { kind: 'allowed' }, setPrimary: { kind: 'allowed' }, remove: { kind: 'allowed' } });
  });

  it.each([
    { dnsStatus: 'PENDING', sslStatus: 'PENDING' },
    { dnsStatus: 'VERIFIED', sslStatus: 'PROVISIONING' },
    { dnsStatus: 'VERIFIED', sslStatus: 'ERROR' },
  ] as const)('asks to verify first before making %o the main address', (status) => {
    expect(domainRowActions(domain(status), 'admin').setPrimary).toEqual({ kind: 'denied', reason: 'settings.domain.reason.verifyFirst' });
  });

  it('does not offer to make the main address the main address', () => {
    expect(domainRowActions(live({ isPrimary: true }), 'admin').setPrimary).toBeNull();
  });

  const saving = { kind: 'denied', reason: 'common.saving' };
  const checking = { kind: 'denied', reason: 'settings.domain.status.checking' };

  it('locks checks, the main address and removal on every row while the main address changes', () => {
    for (const row of [live({ id: 'd1' }), live({ id: 'd2' }), live({ id: 'd3', isPrimary: true })]) {
      const actions = domainRowActions(row, 'admin', { primaryId: 'd1' });
      expect(actions.check).toEqual(saving);
      expect(actions.remove).toEqual(saving);
      if (!row.isPrimary) expect(actions.setPrimary).toEqual(saving);
    }
  });

  it('locks every row while a check runs: a failed check can demote the main address', () => {
    for (const row of [live({ id: 'd1' }), live({ id: 'd2' })]) {
      expect(domainRowActions(row, 'admin', { checkingId: 'd1' })).toEqual({ check: checking, setPrimary: checking, remove: checking });
    }
  });

  it('locks every row while a domain is removed', () => {
    expect(domainRowActions(live({ id: 'd2' }), 'admin', { removingId: 'd1' })).toEqual({ check: saving, setPrimary: saving, remove: saving });
  });

  it('still explains "verify first" over "saving" for a domain that is not live', () => {
    expect(domainRowActions(domain({ id: 'd2' }), 'admin', { checkingId: 'd1' }).setPrimary).toEqual({
      kind: 'denied',
      reason: 'settings.domain.reason.verifyFirst',
    });
  });

  it('turns a decision into control props', () => {
    expect(decisionProps({ kind: 'allowed' })).toEqual({ disabled: false });
    expect(decisionProps({ kind: 'locked' })).toEqual({ disabled: true });
    expect(decisionProps({ kind: 'denied', reason: 'common.saving' })).toEqual({ disabled: true, reason: 'common.saving' });
  });
});
