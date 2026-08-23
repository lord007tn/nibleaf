import path from 'node:path';
import { ImportError } from '@/errors';
import { importDocumentSchema, nonEmptyImportStringSchema } from '@/validators/importers';

const MAX_REFERENCE_DEPTH = 12;

const referenceTarget = (document: unknown, fragment: string) => {
  if (!fragment) return document;
  if (!fragment.startsWith('/')) {
    throw new ImportError({ code: 'import:unsupported', message: `Unsupported Mintlify JSON reference fragment "#${fragment}".` });
  }
  let value = document;
  for (const rawPart of fragment.slice(1).split('/')) {
    const part = decodeURIComponent(rawPart).replaceAll('~1', '/').replaceAll('~0', '~');
    if (Array.isArray(value)) {
      value = value[Number.parseInt(part, 10)];
      continue;
    }
    const object = importDocumentSchema.safeParse(value);
    if (!object.success || !(part in object.data)) {
      throw new ImportError({ code: 'import:not_found', message: `Mintlify JSON reference fragment "#${fragment}" was not found.` });
    }
    value = object.data[part];
  }
  return value;
};

const referencedPath = (currentPath: string, reference: string) => {
  const [rawPath = '', fragment = ''] = reference.split('#', 2);
  if (!rawPath || /^(?:[a-z]+:)?\/\//i.test(rawPath) || rawPath.startsWith('/')) {
    throw new ImportError({ code: 'import:unsupported', message: `Unsupported Mintlify JSON reference "${reference}".` });
  }
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(currentPath), rawPath.replaceAll('\\', '/')));
  if (resolved === '..' || resolved.startsWith('../') || !resolved.endsWith('.json')) {
    throw new ImportError({ code: 'import:unsupported', message: `Mintlify JSON reference must stay inside the repository: "${reference}".` });
  }
  return { path: resolved, fragment };
};

/** Resolve repository-local JSON references before mapping current Mintlify navigation. */
export const resolveMintlifyReferences = async (
  document: unknown,
  configPath: string,
  files: ReadonlySet<string>,
  load: (filePath: string) => Promise<string | null>,
) => {
  const resolveValue = async (value: unknown, currentPath: string, stack: readonly string[], depth: number): Promise<unknown> => {
    if (depth > MAX_REFERENCE_DEPTH) {
      throw new ImportError({ code: 'import:unsupported', message: `Mintlify JSON references exceed ${MAX_REFERENCE_DEPTH} nested files.` });
    }
    if (Array.isArray(value)) {
      return Promise.all(value.map((item) => resolveValue(item, currentPath, stack, depth)));
    }
    const object = importDocumentSchema.safeParse(value);
    if (!object.success) return value;

    const reference = nonEmptyImportStringSchema.safeParse(object.data.$ref);
    if (reference.success) {
      const target = referencedPath(currentPath, reference.data);
      const identity = `${target.path}#${target.fragment}`;
      if (stack.includes(identity)) {
        throw new ImportError({ code: 'import:unsupported', message: `Circular Mintlify JSON reference detected at "${reference.data}".` });
      }
      if (!files.has(target.path)) {
        throw new ImportError({ code: 'import:not_found', message: `Mintlify JSON reference "${target.path}" was not found in the repository.` });
      }
      const raw = await load(target.path);
      if (raw === null) {
        throw new ImportError({ code: 'import:not_found', message: `Could not download Mintlify JSON reference "${target.path}".` });
      }
      let referenced: unknown;
      try {
        referenced = JSON.parse(raw);
      } catch (error) {
        throw new ImportError({
          code: 'import:invalid_document',
          message: `Mintlify JSON reference "${target.path}" is not valid JSON.`,
          cause: error,
        });
      }
      const resolvedTarget = await resolveValue(referenceTarget(referenced, target.fragment), target.path, [...stack, identity], depth + 1);
      const siblings = Object.fromEntries(Object.entries(object.data).filter(([key]) => key !== '$ref'));
      if (Object.keys(siblings).length === 0) return resolvedTarget;
      const resolvedSiblings = await resolveValue(siblings, currentPath, stack, depth + 1);
      const targetObject = importDocumentSchema.safeParse(resolvedTarget);
      const siblingObject = importDocumentSchema.safeParse(resolvedSiblings);
      // Mintlify follows JSON Reference semantics here: siblings only extend
      // object targets. For arrays and primitives the referenced value wins.
      if (!targetObject.success) return resolvedTarget;
      if (!siblingObject.success) return resolvedTarget;
      return { ...targetObject.data, ...siblingObject.data };
    }

    return Object.fromEntries(
      await Promise.all(Object.entries(object.data).map(async ([key, item]) => [key, await resolveValue(item, currentPath, stack, depth + 1)])),
    );
  };

  return resolveValue(document, configPath, [configPath], 0);
};
