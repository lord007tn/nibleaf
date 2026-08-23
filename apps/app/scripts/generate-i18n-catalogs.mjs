import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from '@babel/parser';

const appRoot = resolve(import.meta.dirname, '..');
const force = process.argv.includes('--force');
const allowSourceFallback = process.argv.includes('--allow-source-fallback');
let translationUnavailable = false;
const targetLocales = {
  'zh-CN': 'zh-CN',
  hi: 'hi',
  es: 'es',
  fr: 'fr',
  bn: 'bn',
  'pt-BR': 'pt-BR',
  ru: 'ru',
  ur: 'ur',
  id: 'id',
  de: 'de',
};

const sources = [
  { file: resolve(appRoot, 'src/lib/i18n/messages.ts'), variable: 'messages', output: resolve(appRoot, 'src/lib/i18n/catalogs') },
  { file: resolve(appRoot, 'src/lib/site-i18n.ts'), variable: 'MESSAGES', output: resolve(appRoot, 'src/lib/i18n/site-catalogs') },
  {
    file: resolve(appRoot, 'src/lib/i18n/standalone.ts'),
    variable: 'standaloneMessages',
    output: resolve(appRoot, 'src/lib/i18n/standalone-catalogs'),
  },
];

const propertyName = (property) => {
  if (property.type === 'SpreadElement' || property.type === 'SpreadProperty') return undefined;
  const name = property.key;
  if (name?.type === 'StringLiteral') return name.value;
  if (name?.type === 'Identifier') return name.name;
  return undefined;
};

const unwrap = (expression) => {
  let current = expression;
  while (current.type === 'TSAsExpression' || current.type === 'TSSatisfiesExpression') current = current.expression;
  return current;
};

const englishCatalog = async ({ file, variable }) => {
  const source = await readFile(file, 'utf8');
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript'] });
  let registry;
  for (const statement of ast.program.body) {
    const variableStatement = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
    if (variableStatement?.type !== 'VariableDeclaration') continue;
    for (const declaration of variableStatement.declarations) {
      if (declaration.id.type === 'Identifier' && declaration.id.name === variable && declaration.init) {
        const candidate = unwrap(declaration.init);
        if (candidate.type === 'ObjectExpression') registry = candidate;
      }
    }
  }
  if (!registry) throw new Error(`Unable to find ${variable} in ${file}`);
  const english = registry.properties.find((property) => propertyName(property) === 'en');
  if (english?.type !== 'ObjectProperty') throw new Error(`Unable to find ${variable}.en in ${file}`);
  const object = unwrap(english.value);
  if (object.type !== 'ObjectExpression') throw new Error(`${variable}.en must be an object literal in ${file}`);
  return Object.fromEntries(
    object.properties.map((property) => {
      if (property.type !== 'ObjectProperty') throw new Error(`Unsupported spread/method in ${variable}.en`);
      const key = propertyName(property);
      const value = unwrap(property.value);
      const text =
        value.type === 'StringLiteral'
          ? value.value
          : value.type === 'TemplateLiteral' && value.expressions.length === 0
            ? value.quasis[0]?.value.cooked
            : undefined;
      if (!key || text === undefined) {
        throw new Error(`Every ${variable}.en value must be a plain string (${key ?? 'unknown key'})`);
      }
      return [key, text];
    }),
  );
};

const protectedPattern =
  /(\{[A-Za-z0-9_]+\}|`[^`]+`|https?:\/\/[^\s)]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\b(?:Nibleaf|Mintlify|GitHub|GitLab|OpenAPI|Scalar|Postmark|Cloudflare|Coolify|Markdown|MDX|Docker|Compose|JWT|OAuth|SAML|SCIM|SEO|API|PDF|HTML|CSS|JavaScript|Discord|Slack|Google|Microsoft|Stripe|AGPL-3\.0|BCP-47|RTL|LTR|CLI|CORS|GHCR|Postgres|Redis|Dragonfly|S3|R2|YAML|JSON|slug)\b)/gu;

const shield = (value) => {
  const tokens = [];
  const text = value.replace(protectedPattern, (match) => {
    const token = `__NIBLEAF_TOKEN_${tokens.length}__`;
    tokens.push(match);
    return token;
  });
  return { text, tokens };
};

const unshield = (value, tokens) => {
  let restored = value;
  tokens.forEach((token, index) => {
    const marker = `__NIBLEAF_TOKEN_${index}__`;
    if (!restored.includes(marker)) throw new Error(`Translation removed protected marker ${marker}`);
    restored = restored.replaceAll(marker, token);
  });
  return restored;
};

const translatedText = (payload) => payload[0].map((segment) => segment[0] ?? '').join('');

const requestTranslation = async (text, target, attempt = 1) => {
  const endpoint = new URL('https://translate.googleapis.com/translate_a/single');
  endpoint.searchParams.set('client', 'gtx');
  endpoint.searchParams.set('sl', 'en');
  endpoint.searchParams.set('tl', target);
  endpoint.searchParams.set('dt', 't');
  endpoint.searchParams.set('q', text);
  let response;
  try {
    response = await fetch(endpoint, { headers: { 'user-agent': 'Nibleaf i18n catalog generator' } });
  } catch (error) {
    if (attempt < 5) {
      await new Promise((done) => setTimeout(done, 750 * 2 ** (attempt - 1)));
      return requestTranslation(text, target, attempt + 1);
    }
    throw error;
  }
  if (!response.ok) {
    if (attempt < 5 && (response.status === 429 || response.status >= 500)) {
      await new Promise((done) => setTimeout(done, 750 * 2 ** (attempt - 1)));
      return requestTranslation(text, target, attempt + 1);
    }
    throw new Error(`Translation failed (${response.status} ${response.statusText})`);
  }
  return translatedText(await response.json());
};

const batches = (entries) => {
  const result = [];
  let current = [];
  let size = 0;
  for (const entry of entries) {
    if (current.length > 0 && (current.length >= 35 || size + entry.shielded.text.length > 3_400)) {
      result.push(current);
      current = [];
      size = 0;
    }
    current.push(entry);
    size += entry.shielded.text.length + 32;
  }
  if (current.length > 0) result.push(current);
  return result;
};

const translateBatch = async (batch, target) => {
  if (batch.length === 1) return [await requestTranslation(batch[0].shielded.text, target)];
  const markers = batch.slice(1).map((_, index) => `<<<NIBLEAF_ITEM_${String(index + 1).padStart(4, '0')}>>>`);
  const joined = batch.map((entry, index) => (index === 0 ? entry.shielded.text : `${markers[index - 1]}\n${entry.shielded.text}`)).join('\n');
  const translated = await requestTranslation(joined, target);
  const pattern = new RegExp(`\\n?${markers.join('|')}\\n?`, 'gu');
  const parts = translated.split(pattern);
  if (parts.length !== batch.length) throw new Error(`Expected ${batch.length} translated items, received ${parts.length}`);
  return parts;
};

const translateCatalog = async (catalog, target) => {
  const entries = Object.entries(catalog).map(([key, value]) => ({ key, value, shielded: shield(value) }));
  const translated = {};
  for (const [index, batch] of batches(entries).entries()) {
    const values = await translateBatch(batch, target);
    batch.forEach((entry, itemIndex) => {
      translated[entry.key] = unshield(values[itemIndex].trim(), entry.shielded.tokens);
    });
    if ((index + 1) % 10 === 0) process.stdout.write('.');
    await new Promise((done) => setTimeout(done, 75));
  }
  process.stdout.write('\n');
  return translated;
};

for (const source of sources) {
  const catalog = await englishCatalog(source);
  await mkdir(source.output, { recursive: true });
  const sourceSnapshotFile = resolve(source.output, '_source.json');
  let previousSource = {};
  let hasSourceSnapshot = false;
  if (!force) {
    try {
      previousSource = JSON.parse(await readFile(sourceSnapshotFile, 'utf8'));
      hasSourceSnapshot = true;
    } catch {
      // The first incremental run establishes a source baseline without
      // discarding already-reviewed translations.
    }
  }
  for (const [locale, target] of Object.entries(targetLocales)) {
    const outputFile = resolve(source.output, `${locale}.json`);
    let existing = {};
    if (!force) {
      try {
        existing = JSON.parse(await readFile(outputFile, 'utf8'));
      } catch {
        // A missing or invalid catalog is regenerated below.
      }
    }
    const pending = Object.fromEntries(
      Object.entries(catalog).filter(([key, value]) => !(key in existing) || (hasSourceSnapshot && previousSource[key] !== value)),
    );
    process.stdout.write(`${source.variable}: ${locale} (${Object.keys(pending).length}/${Object.keys(catalog).length} messages) `);
    let additions = {};
    if (Object.keys(pending).length > 0) {
      if (allowSourceFallback && translationUnavailable) {
        additions = pending;
        process.stdout.write('source fallback (provider unavailable) ');
      } else
        try {
          additions = await translateCatalog(pending, target);
        } catch (error) {
          if (!allowSourceFallback) throw error;
          translationUnavailable = true;
          // Explicit recovery mode keeps shipped catalogs key-complete when the
          // translation provider is unavailable. Runtime already treats English
          // as the fallback; Arabic remains hand-reviewed in messages.ts.
          process.stdout.write(`source fallback (${error instanceof Error ? error.message : 'translation unavailable'}) `);
          additions = pending;
        }
    }
    const translated = Object.fromEntries(Object.keys(catalog).map((key) => [key, additions[key] ?? existing[key]]));
    await writeFile(outputFile, `${JSON.stringify(translated, null, 2)}\n`, 'utf8');
  }
  await writeFile(sourceSnapshotFile, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
}
