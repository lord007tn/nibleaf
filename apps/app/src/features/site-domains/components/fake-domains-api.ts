/**
 * A small stateful stand-in for the domains API, for component tests: the
 * network boundary only (`@/services/api`), so the real query, mutations and
 * invalidation run against it. Each site keeps its own list; a request can be
 * held in flight (`hold`) or refused (`refuseNext`), and `onCheck` decides what
 * a DNS check finds. Replies have the shape `getData`/`mutateData` read.
 */
import type { Domain } from '@/hooks/api/types';

export type Endpoint = 'list' | 'add' | 'verify' | 'primary' | 'remove';
export type ApiError = { code?: string; message?: string; details?: Record<string, unknown> };
type Reply = { status: number; body: unknown };
type Request = { endpoint: Endpoint; projectId: string; id?: string; body?: unknown };

/** What a check finds at the DNS provider: the stages to store, and optionally a refusal to answer with (after storing them). */
export type CheckFinding = Pick<Domain, 'dnsStatus' | 'sslStatus'> & {
  ownershipRecordMissing?: boolean;
  lastError?: string | null;
  fail?: { status: number; error: ApiError };
};

/** A held request: `release` lets the server handle it as usual, `refuse` answers with an error and changes nothing. */
export type Gate = { release: () => void; refuse: (status: number, error: ApiError) => void };

const CHECKED_AT = '2026-11-10T09:00:00Z';
const live: CheckFinding = { dnsStatus: 'VERIFIED', sslStatus: 'ACTIVE' };

const sites = new Map<string, Domain[]>();
const requests: Request[] = [];
let gates: Partial<Record<Endpoint, Array<Promise<Reply | undefined>>>> = {};
let refusals: Partial<Record<Endpoint, Reply[]>> = {};
let findCheck: (domain: Domain) => CheckFinding = () => live;

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const list = (projectId: string) => {
  let found = sites.get(projectId);
  if (!found) {
    found = [];
    sites.set(projectId, found);
  }
  return found;
};
const ok = (data: unknown, status = 200): Reply => ({ status, body: { data: copy(data) } });
const error = (status: number, body: ApiError): Reply => ({ status, body: { error: { message: 'Request failed.', ...body } } });
const isLive = (domain: Pick<Domain, 'dnsStatus' | 'sslStatus'>) => domain.dnsStatus === 'VERIFIED' && domain.sslStatus === 'ACTIVE';

export const dnsRecords = (host: string) => [
  { type: 'CNAME', name: host, value: 'cname.nibleaf.test', ttl: 3600 },
  { type: 'TXT', name: `_nibleaf.${host}`, value: 'nibleaf-verify=token', ttl: 3600 },
];

/** The default behaviour of each endpoint: what the real server would store and answer. */
const handlers: Record<Endpoint, (request: Request) => Reply> = {
  list: ({ projectId }) => ok(list(projectId)),
  add: ({ projectId, body }) => {
    const host = (body as { domain: string }).domain;
    const domains = list(projectId);
    if (domains.some((domain) => domain.domain === host)) return error(409, { code: 'domain:already_added' });
    const created: Domain = {
      id: `domain-${host}`,
      domain: host,
      verified: false,
      isPrimary: false,
      dnsStatus: 'PENDING',
      sslStatus: 'PENDING',
      verificationToken: 'token',
      createdAt: CHECKED_AT,
      verifiedAt: null,
      lastCheckedAt: null,
      lastError: null,
      records: dnsRecords(host),
    };
    domains.push(created);
    return ok(created, 201);
  },
  verify: ({ projectId, id }) => {
    const domain = list(projectId).find((item) => item.id === id);
    if (!domain) return error(404, { code: 'not_found' });
    const { fail, ownershipRecordMissing, lastError, ...stages } = findCheck(domain);
    Object.assign(domain, stages, { verified: stages.dnsStatus === 'VERIFIED', lastCheckedAt: CHECKED_AT, lastError: lastError ?? null });
    // A main address that stops working is no longer the main address.
    const demoted = domain.isPrimary && !isLive(domain);
    if (demoted) domain.isPrimary = false;
    if (fail) return error(fail.status, { ...fail.error, details: { ...fail.error.details, demoted } });
    return ok({ ...domain, demoted, ownershipRecordMissing: Boolean(ownershipRecordMissing) });
  },
  primary: ({ projectId, id }) => {
    const domains = list(projectId);
    const target = domains.find((item) => item.id === id);
    if (!target) return error(404, { code: 'not_found' });
    if (!isLive(target)) return error(409, { code: 'domain:not_ready' });
    for (const domain of domains) domain.isPrimary = domain === target;
    return ok(target);
  },
  remove: ({ projectId, id }) => {
    const domains = list(projectId);
    const index = domains.findIndex((item) => item.id === id);
    if (index < 0) return error(404, { code: 'not_found' });
    domains.splice(index, 1);
    return ok({ id });
  },
};

const respond = async (request: Request) => {
  requests.push(copy(request));
  const gate = gates[request.endpoint]?.shift();
  const held = gate ? await gate : undefined;
  const reply = held ?? refusals[request.endpoint]?.shift() ?? handlers[request.endpoint](request);
  const body = copy(reply.body);
  return { ok: reply.status < 400, status: reply.status, headers: { get: () => null }, json: async () => body };
};

type Param = { param: { projectId: string; id?: string } };
const byId = {
  $delete: ({ param }: Param) => respond({ endpoint: 'remove', ...param }),
  verify: { $post: ({ param }: Param) => respond({ endpoint: 'verify', ...param }) },
  primary: { $post: ({ param }: Param) => respond({ endpoint: 'primary', ...param }) },
};

/** The slice of the RPC client the domain hooks use. */
export const api = {
  app: {
    projects: {
      ':projectId': {
        domains: {
          $get: ({ param }: Param) => respond({ endpoint: 'list', ...param }),
          $post: ({ param, json }: Param & { json: unknown }) => respond({ endpoint: 'add', ...param, body: json }),
          ':id': byId,
        },
      },
    },
  },
};

export const server = {
  /** Replaces a site's domains. */
  seed: (projectId: string, domains: Domain[]) => sites.set(projectId, copy(domains)),
  /** What the server now holds for a site. */
  domains: (projectId: string) => copy(list(projectId)),
  /** Every request received for an endpoint, in order (counted on arrival, before any hold). */
  requests: (endpoint: Endpoint) => requests.filter((request) => request.endpoint === endpoint),
  /** Holds the next request to `endpoint` in flight until the returned gate is released or refused. */
  hold: (endpoint: Endpoint): Gate => {
    let settle: (reply: Reply | undefined) => void = () => undefined;
    const pending = new Promise<Reply | undefined>((resolve) => {
      settle = resolve;
    });
    gates[endpoint] = [...(gates[endpoint] ?? []), pending];
    return { release: () => settle(undefined), refuse: (status, body) => settle(error(status, body)) };
  },
  /** Answers the next request to `endpoint` with this error, changing nothing. */
  refuseNext: (endpoint: Endpoint, status: number, body: ApiError) => {
    refusals[endpoint] = [...(refusals[endpoint] ?? []), error(status, body)];
  },
  /** What the next checks find (live, by default). */
  onCheck: (find: (domain: Domain) => CheckFinding) => {
    findCheck = find;
  },
  reset: () => {
    sites.clear();
    requests.length = 0;
    gates = {};
    refusals = {};
    findCheck = () => live;
  },
};
