/**
 * Site settings → Visibility & access → advanced access, as pure logic: what
 * the JWT portal handoff form edits, how it is checked and what a save sends,
 * how audiences are described, and how access-log events are named. Rendered
 * by `components/advanced-access.tsx`; tested in `advanced.test.ts`.
 */
import type { MessageKey } from '@nibleaf/i18n';
import { type JwtAccessConfigBody, jwtAccessConfigBody } from '@nibleaf/validators';

// ─── JWT portal handoff ─────────────────────────────────────────────────────

// Session and token policy every save sends. The form doesn't offer them, so a
// save resets them to these (as it always has).

/** How long a reader session started from a portal JWT lasts: 8 hours. */
export const JWT_SESSION_TTL_MINUTES = 480;
/** The oldest a portal JWT may be when it is presented: 5 minutes. */
export const JWT_MAX_TOKEN_AGE_SECONDS = 300;
/** Clock skew allowed between the portal and Nibleaf. */
export const JWT_CLOCK_TOLERANCE_SECONDS = 30;
/** The claims a reader's identity is read from; not editable here. */
const IDENTITY_CLAIMS = { subjectClaim: 'sub', emailClaim: 'email', nameClaim: 'name' } as const;

const DEFAULT_GROUPS_CLAIM = 'groups';
const CLAIM = /^[A-Za-z0-9_.-]{1,80}$/;
const MAX_AUDIENCE_LENGTH = 500;

/** The stored JWT configuration fields this model reads (a structural copy of the API's). */
export type JwtConfigLike = {
  enabled: boolean;
  issuer: string;
  audience: string;
  jwksUrl: string | null;
  publicJwks: unknown;
  groupsClaim: string;
  claimMapping: unknown;
};

/** Everything the JWT form edits, as the text the person types. */
export type JwtValues = {
  enabled: boolean;
  issuer: string;
  audience: string;
  jwksUrl: string;
  /** JSON text; empty when the keys come from `jwksUrl`. */
  publicJwks: string;
  groupsClaim: string;
  /** JSON text mapping a claim value to an audience id. */
  claimMapping: string;
};

export type JwtField = Exclude<keyof JwtValues, 'enabled'>;

const json = (value: unknown) => JSON.stringify(value, null, 2);

/** The form's values for a stored configuration (or the defaults when there is none yet). */
export function jwtValues(jwt: JwtConfigLike | null | undefined): JwtValues {
  return {
    enabled: jwt?.enabled ?? false,
    issuer: jwt?.issuer ?? '',
    audience: jwt?.audience ?? '',
    jwksUrl: jwt?.jwksUrl ?? '',
    publicJwks: jwt?.publicJwks ? json(jwt.publicJwks) : '',
    groupsClaim: jwt?.groupsClaim ?? DEFAULT_GROUPS_CLAIM,
    claimMapping: json(jwt?.claimMapping ?? {}),
  };
}

/**
 * What a JWT save changes for people signing in from the portal, each worded
 * in the confirmation the save asks for:
 * - `disable`: no new sign-ins through the handoff (existing sessions run out);
 * - `enable`: portal tokens start letting readers in;
 * - `issuer`, `audience`, `keys`: tokens made for the old value are refused.
 */
export type JwtImpact = 'disable' | 'enable' | 'issuer' | 'audience' | 'keys';

/** The confirmation's line for each impact. */
export const JWT_IMPACT_TEXT: Record<JwtImpact, MessageKey> = {
  disable: 'settings.visibility.jwt.impact.disable',
  enable: 'settings.visibility.jwt.impact.enable',
  issuer: 'settings.visibility.jwt.impact.issuer',
  audience: 'settings.visibility.jwt.impact.audience',
  keys: 'settings.visibility.jwt.impact.keys',
};

/** Whether the confirmation also says that existing sessions run on (the disable line already does). */
export const jwtImpactKeepsSessions = (impacts: readonly JwtImpact[]) => impacts.some((impact) => impact !== 'enable' && impact !== 'disable');

/** JSON text compared by meaning, so re-indenting a key set isn't a key change. */
const jsonMeaning = (text: string) => {
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return text.trim();
  }
};

/**
 * The consequences of saving `next` over the saved `saved`, in the order the
 * confirmation lists them. Empty when nothing changes who can sign in (the
 * groups claim, the claim mapping, or any edit while the handoff stays off).
 */
export function jwtChangeImpacts(saved: JwtValues, next: JwtValues): JwtImpact[] {
  if (saved.enabled && !next.enabled) return ['disable'];
  if (!next.enabled) return [];
  if (!saved.enabled) return ['enable'];
  const impacts: JwtImpact[] = [];
  if (saved.issuer.trim() !== next.issuer.trim()) impacts.push('issuer');
  if (saved.audience.trim() !== next.audience.trim()) impacts.push('audience');
  if (saved.jwksUrl.trim() !== next.jwksUrl.trim() || jsonMeaning(saved.publicJwks) !== jsonMeaning(next.publicJwks)) impacts.push('keys');
  return impacts;
}

/** Why a JWT field can't be saved. */
export type JwtProblem = 'required' | 'url' | 'json' | 'claim' | 'keySource' | 'invalid';

const isUrl = (value: string, httpsOnly = false) => {
  try {
    const url = new URL(value);
    return httpsOnly ? url.protocol === 'https:' : true;
  } catch {
    return false;
  }
};

const parseJson = (value: string): { ok: true; value: unknown } | { ok: false } => {
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch {
    return { ok: false };
  }
};

/**
 * What is wrong with one field on its own (checked as the person leaves it).
 * Rules that span fields, and the server schema's own checks, run on save
 * (`jwtSaveRequest`).
 */
const FIELD_CHECKS: Record<JwtField, (value: string) => JwtProblem | undefined> = {
  issuer: (value) => (!value ? 'required' : isUrl(value) ? undefined : 'url'),
  audience: (value) => (!value ? 'required' : value.length > MAX_AUDIENCE_LENGTH ? 'invalid' : undefined),
  jwksUrl: (value) => (!value || isUrl(value, true) ? undefined : 'url'),
  groupsClaim: (value) => (CLAIM.test(value) ? undefined : 'claim'),
  publicJwks: (value) => (!value || parseJson(value).ok ? undefined : 'json'),
  claimMapping: (value) => {
    if (!value) return;
    const parsed = parseJson(value);
    if (!parsed.ok) return 'json';
    const mapping = parsed.value;
    const isStringRecord =
      typeof mapping === 'object' && mapping !== null && !Array.isArray(mapping) && Object.values(mapping).every((item) => typeof item === 'string');
    return isStringRecord ? undefined : 'invalid';
  },
};

export const jwtFieldProblem = (field: JwtField, raw: string): JwtProblem | undefined => FIELD_CHECKS[field](raw.trim());

/** The message for each problem; `required` names its field, so it is worded by the caller with the field's label. */
export const JWT_PROBLEM_TEXT: Record<Exclude<JwtProblem, 'required'>, MessageKey> = {
  url: 'settings.visibility.jwt.error.url',
  json: 'settings.authentication.reader.jsonError',
  claim: 'settings.visibility.jwt.error.claim',
  keySource: 'settings.visibility.jwt.error.keySource',
  invalid: 'settings.visibility.jwt.error.invalid',
};

const FIELDS: readonly JwtField[] = ['issuer', 'audience', 'jwksUrl', 'publicJwks', 'groupsClaim', 'claimMapping'];
const isField = (key: unknown): key is JwtField => typeof key === 'string' && (FIELDS as readonly string[]).includes(key);

export type JwtSaveRequest =
  | { ok: true; body: JwtAccessConfigBody }
  | {
      ok: false;
      /** Each field that can't be saved, and why. */
      problems: Partial<Record<JwtField, JwtProblem>>;
    };

/**
 * What a save sends, or why it can't be sent, field by field. Either a JWKS
 * URL or pasted keys is sent, never both: a URL wins and clears the keys.
 * Every failure, including the server schema refusing a value (or throwing on
 * one it can't parse), lands on the field it is about, never in a toast.
 */
export function jwtSaveRequest(values: JwtValues): JwtSaveRequest {
  const problems: Partial<Record<JwtField, JwtProblem>> = {};
  for (const field of FIELDS) {
    const problem = jwtFieldProblem(field, values[field]);
    if (problem) problems[field] = problem;
  }
  const jwksUrl = values.jwksUrl.trim();
  const publicJwks = values.publicJwks.trim();
  if (!problems.jwksUrl && !problems.publicJwks && Boolean(jwksUrl) === Boolean(publicJwks)) problems.jwksUrl = 'keySource';
  if (Object.keys(problems).length > 0) return { ok: false, problems };

  const candidate = {
    enabled: values.enabled,
    issuer: values.issuer.trim(),
    audience: values.audience.trim(),
    ...(jwksUrl ? { jwksUrl, publicJwks: null } : { jwksUrl: null, publicJwks: JSON.parse(publicJwks) as unknown }),
    ...IDENTITY_CLAIMS,
    groupsClaim: values.groupsClaim.trim(),
    claimMapping: values.claimMapping.trim() ? (JSON.parse(values.claimMapping) as unknown) : {},
    sessionTtlMinutes: JWT_SESSION_TTL_MINUTES,
    maxTokenAgeSeconds: JWT_MAX_TOKEN_AGE_SECONDS,
    clockToleranceSecs: JWT_CLOCK_TOLERANCE_SECONDS,
  };
  let parsed: ReturnType<typeof jwtAccessConfigBody.safeParse>;
  try {
    parsed = jwtAccessConfigBody.safeParse(candidate);
  } catch {
    // The schema's HTTPS refinement parses the JWKS URL itself and throws on one it can't read.
    return { ok: false, problems: { jwksUrl: 'url' } };
  }
  if (parsed.success) return { ok: true, body: parsed.data };
  for (const issue of parsed.error.issues) {
    const [first] = issue.path;
    // The schema's cross-field rules (one key source; HTTPS) have no path: both are about the JWKS URL.
    const field: JwtField = isField(first) ? first : 'jwksUrl';
    problems[field] ??= field === 'jwksUrl' && !isField(first) ? (jwksUrl ? 'url' : 'keySource') : 'invalid';
  }
  return { ok: false, problems };
}

/** The form's values for what a save sent, as the server will store them. */
export const jwtSavedValues = (body: JwtAccessConfigBody): JwtValues =>
  jwtValues({ ...body, jwksUrl: body.jwksUrl ?? null, publicJwks: body.publicJwks ?? null });

// ─── Audiences ──────────────────────────────────────────────────────────────

export type AudienceScope = { kind: 'site' } | { kind: 'pages'; count: number };

/** What an audience can read: the whole site, or a number of pages. */
export function audienceScope(audience: { grants: ReadonlyArray<{ pageId: string | null }> }): AudienceScope {
  return audience.grants.some((grant) => !grant.pageId) ? { kind: 'site' } : { kind: 'pages', count: audience.grants.length };
}

/** Only pages (not folders or links) can be granted to an audience. */
export const grantablePages = <P extends { kind: string }>(pages: readonly P[]): P[] => pages.filter((page) => page.kind === 'PAGE');

/** What creating an audience sends: the name trimmed and the chosen pages (none means the whole site). */
export const audienceRequest = (values: { name: string; pageIds: string[] }) => ({ name: values.name.trim(), pageIds: values.pageIds });

export const audienceNameProblem = (value: string): 'required' | undefined => (value.trim() ? undefined : 'required');

// ─── Access log ─────────────────────────────────────────────────────────────

/** Audit actions emitted by apps/server/src/actions/reader-access.ts and site-sign-in.ts. */
const AUDIT_ACTION_KEYS: Record<string, MessageKey> = {
  ACCESS_MODE_CHANGED: 'settings.authentication.reader.audit.action.accessModeChanged',
  AUDIENCE_CREATED: 'settings.authentication.reader.audit.action.audienceCreated',
  AUDIENCE_UPDATED: 'settings.authentication.reader.audit.action.audienceUpdated',
  AUDIENCE_DELETED: 'settings.authentication.reader.audit.action.audienceDeleted',
  READER_INVITED: 'settings.authentication.reader.audit.action.readerInvited',
  READER_UPDATED: 'settings.authentication.reader.audit.action.readerUpdated',
  READER_REVOKED: 'settings.authentication.reader.audit.action.readerRevoked',
  EMERGENCY_REVOKE: 'settings.authentication.reader.audit.action.emergencyRevoke',
  JWT_CONFIGURATION_UPDATED: 'settings.authentication.reader.audit.action.jwtConfigurationUpdated',
  INVITATION_ACTIVATED: 'settings.authentication.reader.audit.action.invitationActivated',
  JWT_REJECTED: 'settings.authentication.reader.audit.action.jwtRejected',
  JWT_SESSION_CREATED: 'settings.authentication.reader.audit.action.jwtSessionCreated',
  READER_SIGNED_IN: 'settings.visibility.audit.readerSignedIn',
  MEMBER_SIGNED_IN: 'settings.visibility.audit.memberSignedIn',
  READER_ADDED_BY_DOMAIN: 'settings.visibility.audit.readerAddedByDomain',
  EMAIL_DOMAINS_UPDATED: 'settings.visibility.audit.emailDomainsUpdated',
  ACCESS_REQUESTED: 'settings.visibility.audit.accessRequested',
  ACCESS_REQUEST_APPROVED: 'settings.visibility.audit.accessRequestApproved',
  ACCESS_REQUEST_DECLINED: 'settings.visibility.audit.accessRequestDeclined',
  ACCESS_REQUESTS_CHANGED: 'settings.visibility.audit.accessRequestsChanged',
};

/** The message for an access-log action; an action this build doesn't know is shown as it is. */
export function auditActionLabel(action: string): { key: MessageKey } | { raw: string } {
  const key = AUDIT_ACTION_KEYS[action];
  return key ? { key } : { raw: action };
}
