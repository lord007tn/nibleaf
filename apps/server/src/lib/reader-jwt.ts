import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createLocalJWKSet, createRemoteJWKSet, customFetch, errors, type JSONWebKeySet, type JWTPayload, jwtVerify } from 'jose';

const ALGORITHMS = ['RS256', 'PS256', 'ES256', 'EdDSA'] as const;
const remoteSets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export const isPrivateNetworkAddress = (raw: string): boolean => {
  const value = raw.toLowerCase().split('%')[0] ?? '';
  const mapped = value.startsWith('::ffff:') ? value.slice(7) : value;
  if (isIP(mapped) === 4) {
    const octets = mapped.split('.').map(Number);
    const [a = 0, b = 0] = octets;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  return value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd') || /^fe[89ab]/.test(value);
};

/** Reject JWKS endpoints that can reach loopback, link-local, or private
 * infrastructure. This check runs both when saving and immediately before each
 * fetch to reduce DNS-rebinding/SSRF exposure. */
export const assertPublicJwksUrl = async (raw: string): Promise<void> => {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.port)
    throw new TypeError('JWKS URL must be a credential-free HTTPS URL on port 443.');
  const answers = await lookup(url.hostname, { all: true, verbatim: true });
  if (answers.length === 0 || answers.some((answer) => isPrivateNetworkAddress(answer.address))) {
    throw new TypeError('JWKS URL resolves to a private or reserved network.');
  }
};

const guardedFetch = async (url: string, options: Parameters<typeof fetch>[1]): Promise<Response> => {
  await assertPublicJwksUrl(url);
  return fetch(url, { ...options, redirect: 'manual' });
};

export interface ReaderJwtConfiguration {
  issuer: string;
  audience: string;
  jwksUrl: string | null;
  publicJwks: unknown;
  maxTokenAgeSeconds: number;
  clockToleranceSecs: number;
}

export const jwtReplayHash = (issuer: string, jti: string): string => createHash('sha256').update(`${issuer}\0${jti}`).digest('hex');

export const claimAt = (payload: JWTPayload, path: string): unknown => {
  let value: unknown = payload;
  for (const segment of path.split('.')) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
};

export const claimStrings = (value: unknown): string[] => {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
};

const publicKeySet = (configuration: ReaderJwtConfiguration) => {
  if (configuration.jwksUrl) {
    let set = remoteSets.get(configuration.jwksUrl);
    if (!set) {
      set = createRemoteJWKSet(new URL(configuration.jwksUrl), {
        timeoutDuration: 5000,
        cooldownDuration: 30_000,
        cacheMaxAge: 10 * 60_000,
        [customFetch]: guardedFetch,
      });
      remoteSets.set(configuration.jwksUrl, set);
    }
    return set;
  }
  return createLocalJWKSet(configuration.publicJwks as JSONWebKeySet);
};

/** Verify a short-lived portal assertion. All trust decisions are explicit:
 * asymmetric signature, algorithm allowlist, issuer, audience, exp, iat age,
 * and a required jti that the caller persists for replay prevention. */
export const verifyReaderJwt = async (token: string, configuration: ReaderJwtConfiguration): Promise<JWTPayload> => {
  const { payload } = await jwtVerify(token, publicKeySet(configuration), {
    algorithms: [...ALGORITHMS],
    issuer: configuration.issuer,
    audience: configuration.audience,
    clockTolerance: configuration.clockToleranceSecs,
    maxTokenAge: `${configuration.maxTokenAgeSeconds}s`,
    requiredClaims: ['exp', 'iat', 'jti', 'sub'],
  });
  return payload;
};

export const isJwtVerificationError = (error: unknown): boolean =>
  error instanceof errors.JOSEError || (error instanceof TypeError && /JWK|JWKS|URL|fetch/i.test(error.message));
