import { describe, expect, it } from 'vitest';
import {
  audienceNameProblem,
  audienceRequest,
  audienceScope,
  auditActionLabel,
  grantablePages,
  JWT_CLOCK_TOLERANCE_SECONDS,
  JWT_MAX_TOKEN_AGE_SECONDS,
  JWT_SESSION_TTL_MINUTES,
  type JwtValues,
  jwtChangeImpacts,
  jwtFieldProblem,
  jwtSavedValues,
  jwtSaveRequest,
  jwtValues,
} from './advanced';

const valid: JwtValues = {
  enabled: true,
  issuer: 'https://portal.example.com',
  audience: 'nibleaf-docs',
  jwksUrl: 'https://portal.example.com/.well-known/jwks.json',
  publicJwks: '',
  groupsClaim: 'groups',
  claimMapping: '{"customer": "aud-1"}',
};

describe('JWT form values', () => {
  it('starts from the defaults when nothing is configured', () => {
    expect(jwtValues(null)).toEqual({
      enabled: false,
      issuer: '',
      audience: '',
      jwksUrl: '',
      publicJwks: '',
      groupsClaim: 'groups',
      claimMapping: '{}',
    });
  });

  it('shows stored JSON as indented text', () => {
    const values = jwtValues({
      enabled: true,
      issuer: 'https://p.example',
      audience: 'docs',
      jwksUrl: null,
      publicJwks: { keys: [{ kty: 'OKP' }] },
      groupsClaim: 'roles',
      claimMapping: { a: 'b' },
    });
    expect(values.jwksUrl).toBe('');
    expect(values.publicJwks).toBe(JSON.stringify({ keys: [{ kty: 'OKP' }] }, null, 2));
    expect(values.claimMapping).toBe('{\n  "a": "b"\n}');
  });
});

describe('checking one JWT field', () => {
  it('needs an issuer address and an audience', () => {
    expect(jwtFieldProblem('issuer', ' ')).toBe('required');
    expect(jwtFieldProblem('issuer', 'portal')).toBe('url');
    expect(jwtFieldProblem('issuer', 'https://portal.example.com')).toBeUndefined();
    expect(jwtFieldProblem('audience', '')).toBe('required');
    expect(jwtFieldProblem('audience', 'x'.repeat(501))).toBe('invalid');
  });

  it('takes only an https JWKS URL, or none', () => {
    expect(jwtFieldProblem('jwksUrl', '')).toBeUndefined();
    expect(jwtFieldProblem('jwksUrl', 'http://portal.example.com/jwks')).toBe('url');
    expect(jwtFieldProblem('jwksUrl', 'not a url')).toBe('url');
  });

  it('checks the claim name and the JSON boxes', () => {
    expect(jwtFieldProblem('groupsClaim', 'app roles')).toBe('claim');
    expect(jwtFieldProblem('groupsClaim', 'app.roles')).toBeUndefined();
    expect(jwtFieldProblem('publicJwks', '{"keys": [')).toBe('json');
    expect(jwtFieldProblem('claimMapping', '{oops')).toBe('json');
    expect(jwtFieldProblem('claimMapping', '["a"]')).toBe('invalid');
    expect(jwtFieldProblem('claimMapping', '{"a": 1}')).toBe('invalid');
    expect(jwtFieldProblem('claimMapping', '')).toBeUndefined();
  });
});

describe('what a JWT save sends', () => {
  it('sends the configuration with the named session and token policy', () => {
    const request = jwtSaveRequest({ ...valid, issuer: ' https://portal.example.com ' });
    expect(request).toEqual({
      ok: true,
      body: {
        enabled: true,
        issuer: 'https://portal.example.com',
        audience: 'nibleaf-docs',
        jwksUrl: 'https://portal.example.com/.well-known/jwks.json',
        publicJwks: null,
        subjectClaim: 'sub',
        emailClaim: 'email',
        nameClaim: 'name',
        groupsClaim: 'groups',
        claimMapping: { customer: 'aud-1' },
        sessionTtlMinutes: JWT_SESSION_TTL_MINUTES,
        maxTokenAgeSeconds: JWT_MAX_TOKEN_AGE_SECONDS,
        clockToleranceSecs: JWT_CLOCK_TOLERANCE_SECONDS,
      },
    });
    expect([JWT_SESSION_TTL_MINUTES, JWT_MAX_TOKEN_AGE_SECONDS, JWT_CLOCK_TOLERANCE_SECONDS]).toEqual([480, 300, 30]);
  });

  it('needs exactly one key source, said on the JWKS URL field', () => {
    expect(jwtSaveRequest({ ...valid, jwksUrl: '' })).toEqual({ ok: false, problems: { jwksUrl: 'keySource' } });
    expect(jwtSaveRequest({ ...valid, publicJwks: '{"keys": []}' })).toEqual({ ok: false, problems: { jwksUrl: 'keySource' } });
  });

  it('puts every problem on its field instead of failing as a whole', () => {
    expect(jwtSaveRequest({ ...valid, issuer: '', claimMapping: '{', groupsClaim: '' })).toEqual({
      ok: false,
      problems: { issuer: 'required', claimMapping: 'json', groupsClaim: 'claim' },
    });
  });

  it('turns the server schema refusing pasted keys into a field error', () => {
    // Valid JSON, but not a public key set the schema accepts.
    expect(jwtSaveRequest({ ...valid, jwksUrl: '', publicJwks: '{"keys": [{"kty": "oct", "k": "secret"}]}' })).toEqual({
      ok: false,
      problems: { publicJwks: 'invalid' },
    });
  });

  it('reads back what a save sent as the form values the server will show', () => {
    const request = jwtSaveRequest(valid);
    if (!request.ok) throw new Error('expected a valid request');
    expect(jwtSavedValues(request.body)).toEqual({ ...valid, claimMapping: '{\n  "customer": "aud-1"\n}' });
  });
});

describe('audiences', () => {
  it('says whether an audience covers the whole site or some pages', () => {
    expect(audienceScope({ grants: [{ pageId: null }] })).toEqual({ kind: 'site' });
    expect(audienceScope({ grants: [{ pageId: 'p1' }, { pageId: 'p2' }] })).toEqual({ kind: 'pages', count: 2 });
  });

  it('grants pages only, and sends a trimmed name', () => {
    expect(grantablePages([{ kind: 'PAGE' }, { kind: 'FOLDER' }, { kind: 'LINK' }])).toEqual([{ kind: 'PAGE' }]);
    expect(audienceRequest({ name: ' Customers ', pageIds: ['p1'] })).toEqual({ name: 'Customers', pageIds: ['p1'] });
    expect(audienceNameProblem('  ')).toBe('required');
    expect(audienceNameProblem('Customers')).toBeUndefined();
  });
});

describe('access log', () => {
  it('names known actions and shows an unknown one as it is', () => {
    expect(auditActionLabel('READER_REVOKED')).toEqual({ key: 'settings.authentication.reader.audit.action.readerRevoked' });
    expect(auditActionLabel('ACCESS_REQUESTED')).toEqual({ key: 'settings.visibility.audit.accessRequested' });
    expect(auditActionLabel('SOMETHING_NEW')).toEqual({ raw: 'SOMETHING_NEW' });
  });
});

describe('jwtChangeImpacts', () => {
  const saved = jwtValues({
    enabled: true,
    issuer: 'https://portal.example.com',
    audience: 'docs',
    jwksUrl: 'https://portal.example.com/jwks.json',
    publicJwks: null,
    groupsClaim: 'groups',
    claimMapping: {},
  });

  it('asks before turning the handoff off, and only says that', () => {
    expect(jwtChangeImpacts(saved, { ...saved, enabled: false, issuer: 'https://other.example.com' })).toEqual(['disable']);
  });

  it('asks before turning it on', () => {
    expect(jwtChangeImpacts({ ...saved, enabled: false }, saved)).toEqual(['enable']);
  });

  it('names each change that refuses tokens made for the old value', () => {
    expect(
      jwtChangeImpacts(saved, { ...saved, issuer: 'https://login.example.com', audience: 'docs-v2', jwksUrl: '', publicJwks: '{"keys":[]}' }),
    ).toEqual(['issuer', 'audience', 'keys']);
    expect(jwtChangeImpacts(saved, { ...saved, jwksUrl: 'https://portal.example.com/v2/jwks.json' })).toEqual(['keys']);
  });

  it('needs no confirmation for changes that keep the same tokens working', () => {
    expect(jwtChangeImpacts(saved, { ...saved, groupsClaim: 'teams', claimMapping: '{"acme": "aud-1"}' })).toEqual([]);
    expect(jwtChangeImpacts(saved, { ...saved, issuer: ' https://portal.example.com ' })).toEqual([]);
    const pasted = { ...saved, jwksUrl: '', publicJwks: '{"keys": [{"kty": "EC"}]}' };
    expect(jwtChangeImpacts(pasted, { ...pasted, publicJwks: JSON.stringify({ keys: [{ kty: 'EC' }] }, null, 2) })).toEqual([]);
    const off = { ...saved, enabled: false };
    expect(jwtChangeImpacts(off, { ...off, issuer: 'https://login.example.com' })).toEqual([]);
  });
});
