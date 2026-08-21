import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { type Prisma, prisma } from '@nibleaf/database';
import type { GitConfig, OpenApiSourceInput, UpsertOpenApiBody } from '@nibleaf/validators';
import { bundle, type LoaderPlugin } from '@scalar/json-magic/bundle';
import { validate } from '@scalar/openapi-parser';
import { Agent, type Response as UndiciResponse, fetch as undiciFetch } from 'undici';
import { parseDocument } from 'yaml';
import { badRequest, notFound } from '@/errors';
import { isPrivateIp } from '@/lib/client-ip';
import { assertProjectInOrg } from './projects';

export const MAX_OPENAPI_BYTES = 5_000_000;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_EXTERNAL_DOCUMENTS = 20;
const EXTERNAL_DOCUMENTS_KEY = 'x-nibleaf-external';

type OpenApiObject = Record<string, unknown>;

const sourceView = (row: { sourceType: 'UPLOAD' | 'URL' | 'REPOSITORY'; sourceUrl: string | null; sourcePath: string | null }) =>
  row.sourceType === 'URL'
    ? { type: 'url' as const, url: row.sourceUrl ?? '' }
    : row.sourceType === 'REPOSITORY'
      ? { type: 'repository' as const, path: row.sourcePath ?? '' }
      : { type: 'upload' as const };

export const publicOpenApiMetadata = (row: { title: string; path: string; contentHash: string; updatedAt: Date | string }) => ({
  title: row.title,
  path: row.path,
  contentHash: row.contentHash,
  updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
});

export const openApiRecordView = (row: {
  title: string;
  path: string;
  sourceType: 'UPLOAD' | 'URL' | 'REPOSITORY';
  sourceUrl: string | null;
  sourcePath: string | null;
  contentHash: string;
  updatedAt: Date | string;
}) => ({ ...publicOpenApiMetadata(row), source: sourceView(row) });

const collectExternalRefs = (value: unknown, path = '$', refs: string[] = []): string[] => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectExternalRefs(item, `${path}[${index}]`, refs);
    });
    return refs;
  }
  if (!value || typeof value !== 'object') {
    return refs;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    if (key === '$ref' && typeof child === 'string' && !child.startsWith('#/')) {
      refs.push(`${childPath}: ${child}`);
    } else {
      collectExternalRefs(child, childPath, refs);
    }
  }
  return refs;
};

/** Parse JSON/YAML with bounded aliases, require OpenAPI 3.x, securely bundle
 * public external references, then run Scalar's standards validator. */
export const parseAndValidateOpenApi = async (content: string, origin?: string): Promise<OpenApiObject> => {
  if (!content.trim()) {
    throw badRequest('The OpenAPI document is empty.');
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_OPENAPI_BYTES) {
    throw badRequest('The OpenAPI document is larger than 5 MB.');
  }

  const yaml = parseDocument(content, { uniqueKeys: true });
  if (yaml.errors.length > 0) {
    throw badRequest('The OpenAPI document is not valid JSON or YAML.', {
      errors: yaml.errors.slice(0, 10).map((error) => error.message),
    });
  }
  let parsed: unknown;
  try {
    parsed = yaml.toJS({ maxAliasCount: 20 }) as unknown;
  } catch (error) {
    throw badRequest('The OpenAPI document uses unsafe or excessively complex YAML aliases.', {
      errors: [error instanceof Error ? error.message : 'Could not expand YAML aliases.'],
    });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw badRequest('The OpenAPI document must be an object.');
  }
  const document = parsed as OpenApiObject;
  if (typeof document.openapi !== 'string' || !/^3\.\d+\.\d+(?:[-+].*)?$/.test(document.openapi)) {
    throw badRequest('Only OpenAPI 3.x documents are supported. Add an openapi field such as "3.1.0".');
  }

  const externalRefs = collectExternalRefs(document);
  let validatedDocument = document;
  if (externalRefs.length > 0) {
    let totalBytes = Buffer.byteLength(content, 'utf8');
    let referenceFailure: unknown;
    const fetchedUrls = new Set<string>();
    const unresolvedRefs: string[] = [];
    const publicReferenceLoader: LoaderPlugin = {
      type: 'loader',
      validate: (value) => /^https?:\/\//i.test(value),
      exec: async (url) => {
        if (!fetchedUrls.has(url)) {
          fetchedUrls.add(url);
          if (fetchedUrls.size > MAX_EXTERNAL_DOCUMENTS) {
            const error = badRequest(`The OpenAPI document references more than ${MAX_EXTERNAL_DOCUMENTS} external files.`);
            referenceFailure = error;
            return { ok: false };
          }
        }
        try {
          const referencedContent = await fetchPublicOpenApi(url, 'OpenAPI reference');
          totalBytes += Buffer.byteLength(referencedContent, 'utf8');
          if (totalBytes > MAX_OPENAPI_BYTES) {
            throw badRequest('The OpenAPI document and its external references are larger than 5 MB.');
          }
          const referencedYaml = parseDocument(referencedContent, { uniqueKeys: true });
          if (referencedYaml.errors.length > 0) {
            throw badRequest('An external OpenAPI reference is not valid JSON or YAML.', {
              errors: referencedYaml.errors.slice(0, 10).map((error) => error.message),
            });
          }
          let data: unknown;
          try {
            data = referencedYaml.toJS({ maxAliasCount: 20 }) as unknown;
          } catch (error) {
            throw badRequest('An external OpenAPI reference uses unsafe or excessively complex YAML aliases.', {
              errors: [error instanceof Error ? error.message : 'Could not expand YAML aliases.'],
            });
          }
          return { ok: true, data, raw: referencedContent };
        } catch (error) {
          referenceFailure = error;
          return { ok: false };
        }
      },
    };

    validatedDocument = (await bundle(document, {
      plugins: [publicReferenceLoader],
      treeShake: true,
      urlMap: false,
      depth: 12,
      ...(origin ? { origin } : {}),
      externalDocumentsKey: EXTERNAL_DOCUMENTS_KEY,
      hooks: {
        onResolveError: (node) => unresolvedRefs.push(String(node.$ref ?? 'unknown reference')),
      },
    })) as OpenApiObject;

    if (referenceFailure) throw referenceFailure;
    const remainingRefs = collectExternalRefs(validatedDocument);
    if (unresolvedRefs.length > 0 || remainingRefs.length > 0) {
      throw badRequest(
        origin
          ? 'One or more external OpenAPI references could not be resolved from a public HTTP(S) location.'
          : 'Relative external references require a URL or repository source. Uploads may use absolute public HTTP(S) references.',
        { errors: [...unresolvedRefs, ...remainingRefs].slice(0, 10) },
      );
    }
  }

  const result = await validate(validatedDocument);
  if (!result.valid) {
    throw badRequest('The OpenAPI document failed validation.', {
      errors: result.errors.slice(0, 20).map((error) => ({
        path: Array.isArray(error.path) ? (error.path.length ? error.path.join('.') : '$') : typeof error.path === 'string' ? error.path : '$',
        message: error.message,
        ...(error.code ? { code: error.code } : {}),
      })),
    });
  }
  return validatedDocument;
};

/** Consume a fetch body incrementally so a missing or dishonest Content-Length
 *  cannot make the server buffer an unbounded document. */
export const readBoundedOpenApiResponse = async (response: Response | UndiciResponse): Promise<string> => {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_OPENAPI_BYTES) {
      await reader.cancel();
      throw badRequest('The OpenAPI document is larger than 5 MB.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
};

type PinnedPublicUrl = {
  url: URL;
  address: string;
  family: 4 | 6;
};

/** Resolve once, reject every non-public answer, and retain one validated
 * address for the connection itself. The URL intentionally keeps its original
 * hostname so Undici still sends the correct Host header and TLS SNI. */
const normalizePublicUrl = async (value: string, label: string): Promise<PinnedPublicUrl> => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw badRequest(`Enter a valid ${label}.`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw badRequest(`${label} must use http(s).`);
  }
  if (url.username || url.password) {
    throw badRequest(`${label} must not include embedded credentials.`);
  }
  let records: Array<{ address: string; family: number }>;
  try {
    records = await lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw badRequest(`${label} could not be resolved. Check the hostname and try again.`);
  }
  if (records.length === 0 || records.some((record) => (record.family !== 4 && record.family !== 6) || isPrivateIp(record.address))) {
    throw badRequest(`${label} must resolve only to public IP addresses.`);
  }
  const selected = records[0] as { address: string; family: 4 | 6 };
  return { url, address: selected.address, family: selected.family };
};

/** Bind an Undici connection to the address that passed the public-network
 * check. This closes the DNS-rebinding gap between validation and connect. */
const pinnedDispatcher = ({ address, family }: PinnedPublicUrl): Agent =>
  new Agent({
    connect: {
      lookup: (_hostname, _options, callback) => callback(null, address, family),
    },
  });

/** Fetch a public spec without credentials, following only a small number of
 *  revalidated public redirects. The response body is bounded before parsing. */
export const fetchPublicOpenApi = async (value: string, label = 'OpenAPI URL'): Promise<string> => {
  let current = await normalizePublicUrl(value, label);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const dispatcher = pinnedDispatcher(current);
    let response: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      response = await undiciFetch(current.url, {
        headers: { Accept: 'application/json, application/yaml, text/yaml, text/plain', 'User-Agent': 'nibleaf-openapi' },
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        dispatcher,
      });
    } catch {
      await dispatcher.close();
      throw badRequest(`Could not fetch the ${label.toLowerCase()}. Check that it is publicly reachable.`);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location || redirect === MAX_REDIRECTS) {
        await response.body?.cancel();
        await dispatcher.close();
        throw badRequest(`The ${label.toLowerCase()} redirected too many times.`);
      }
      await response.body?.cancel();
      await dispatcher.close();
      current = await normalizePublicUrl(new URL(location, current.url).toString(), label);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      await dispatcher.close();
      throw badRequest(`The ${label.toLowerCase()} returned HTTP ${response.status}.`);
    }
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > MAX_OPENAPI_BYTES) {
      await response.body?.cancel();
      await dispatcher.close();
      throw badRequest('The OpenAPI document is larger than 5 MB.');
    }
    try {
      return await readBoundedOpenApiResponse(response);
    } finally {
      await dispatcher.close();
    }
  }
  throw badRequest(`Could not fetch the ${label.toLowerCase()}.`);
};

const parseWorkspaceGit = (metadata: string | null): GitConfig => {
  try {
    const parsed = metadata ? (JSON.parse(metadata) as Record<string, unknown>) : {};
    return (parsed.git ?? {}) as GitConfig;
  } catch {
    return {};
  }
};

const encodePath = (value: string): string => value.split('/').map(encodeURIComponent).join('/');

const repositorySpecUrl = async (organizationId: string, filePath: string): Promise<string> => {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { metadata: true } });
  const git = parseWorkspaceGit(org?.metadata ?? null);
  const branch = git.branch?.trim() || 'main';
  const provider = git.provider ?? 'github';
  if (provider === 'github' && git.repo?.split('/').length === 2) {
    return `https://raw.githubusercontent.com/${encodePath(git.repo)}/${encodeURIComponent(branch)}/${encodePath(filePath)}`;
  }
  if (provider === 'gitlab' && git.repo?.includes('/')) {
    const { url: instance } = await normalizePublicUrl(git.instanceUrl?.trim() || 'https://gitlab.com', 'GitLab instance URL');
    instance.pathname = instance.pathname.replace(/\/+$/, '');
    const url = new URL(
      `${instance.toString().replace(/\/+$/, '')}/api/v4/projects/${encodeURIComponent(git.repo)}/repository/files/${encodeURIComponent(filePath)}/raw`,
    );
    url.searchParams.set('ref', branch);
    return url.toString();
  }
  throw badRequest('Repository-backed OpenAPI currently requires a configured public GitHub or GitLab repository.');
};

const sourceContent = async (organizationId: string, source: OpenApiSourceInput): Promise<{ content: string; origin?: string }> => {
  if (source.type === 'upload') return { content: source.content };
  const origin = source.type === 'url' ? source.url : await repositorySpecUrl(organizationId, source.path);
  return {
    content: await fetchPublicOpenApi(origin, source.type === 'url' ? 'OpenAPI URL' : 'repository OpenAPI file'),
    origin,
  };
};

export const getOpenApiDocument = async (organizationId: string, projectId: string) => {
  await assertProjectInOrg(organizationId, projectId);
  const row = await prisma.openApiDocument.findUnique({ where: { projectId } });
  return row ? openApiRecordView(row) : null;
};

export const upsertOpenApiDocument = async (organizationId: string, projectId: string, body: UpsertOpenApiBody) => {
  await assertProjectInOrg(organizationId, projectId);
  if (['changelog', 'robots.txt', 'sitemap.xml', 'llms.txt', 'llms-full.txt'].includes(body.path)) {
    throw badRequest('That API Reference path is reserved by the published site.', { path: body.path });
  }
  const collision = await prisma.page.findFirst({ where: { projectId, path: body.path }, select: { id: true } });
  if (collision) {
    throw badRequest('That API Reference path is already used by a documentation page.', { path: body.path });
  }
  const existing = body.source ? null : await prisma.openApiDocument.findUnique({ where: { projectId } });
  if (!(body.source || existing)) {
    throw badRequest('Choose an OpenAPI upload, URL, or repository file for the first save.');
  }
  const sourceDocument = body.source ? await sourceContent(organizationId, body.source) : null;
  const document = sourceDocument
    ? await parseAndValidateOpenApi(sourceDocument.content, sourceDocument.origin)
    : (existing?.document as OpenApiObject);
  const contentHash = body.source ? createHash('sha256').update(JSON.stringify(document)).digest('hex') : (existing?.contentHash as string);
  const sourceType = body.source
    ? body.source.type === 'upload'
      ? 'UPLOAD'
      : body.source.type === 'url'
        ? 'URL'
        : 'REPOSITORY'
    : (existing?.sourceType as 'UPLOAD' | 'URL' | 'REPOSITORY');
  const sourceUrl = body.source ? (body.source.type === 'url' ? body.source.url : null) : (existing?.sourceUrl ?? null);
  const sourcePath = body.source ? (body.source.type === 'repository' ? body.source.path : null) : (existing?.sourcePath ?? null);
  const row = await prisma.openApiDocument.upsert({
    where: { projectId },
    create: {
      projectId,
      title: body.title,
      path: body.path,
      sourceType,
      sourceUrl,
      sourcePath,
      document: document as Prisma.InputJsonValue,
      contentHash,
    },
    update: {
      title: body.title,
      path: body.path,
      sourceType,
      sourceUrl,
      sourcePath,
      document: document as Prisma.InputJsonValue,
      contentHash,
    },
  });
  return openApiRecordView(row);
};

export const syncOpenApiDocument = async (organizationId: string, projectId: string) => {
  await assertProjectInOrg(organizationId, projectId);
  const existing = await prisma.openApiDocument.findUnique({ where: { projectId } });
  if (!existing) throw notFound('OpenAPI document', { projectId });
  if (existing.sourceType === 'UPLOAD') {
    throw badRequest('Uploaded OpenAPI documents cannot be synced. Upload a replacement file instead.');
  }
  const source: OpenApiSourceInput =
    existing.sourceType === 'URL' ? { type: 'url', url: existing.sourceUrl ?? '' } : { type: 'repository', path: existing.sourcePath ?? '' };
  return upsertOpenApiDocument(organizationId, projectId, { title: existing.title, path: existing.path, source });
};

export const deleteOpenApiDocument = async (organizationId: string, projectId: string) => {
  await assertProjectInOrg(organizationId, projectId);
  await prisma.openApiDocument.deleteMany({ where: { projectId } });
  return { projectId };
};
