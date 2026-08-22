import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from '@babel/parser';
import type { Expression, ObjectExpression } from '@babel/types';
import type { Plugin } from 'vite';

const virtualPrefix = 'virtual:nibleaf-messages/';
const resolvedPrefix = `\0${virtualPrefix}`;
const sourceFile = resolve(import.meta.dirname, '../src/lib/i18n/messages.ts');
const generatedCatalogDirectory = resolve(import.meta.dirname, '../src/lib/i18n/catalogs');

type CatalogNamespace = 'app' | 'auth';
type CatalogLocale = 'ar' | 'bn' | 'de' | 'en' | 'es' | 'fr' | 'hi' | 'id' | 'pt-BR' | 'ru' | 'ur' | 'zh-CN';

const catalogLocales = new Set<CatalogLocale>(['ar', 'bn', 'de', 'en', 'es', 'fr', 'hi', 'id', 'pt-BR', 'ru', 'ur', 'zh-CN']);
const isAuthMessage = (key: string | undefined) =>
  Boolean(key?.startsWith('common.') || key?.startsWith('auth.') || key?.startsWith('account.language'));

const propertyName = (property: ObjectExpression['properties'][number]): string | undefined => {
  if (property.type === 'SpreadElement') return undefined;
  const name = property.key;
  if (name.type === 'StringLiteral') return name.value;
  if (name.type === 'Identifier') return name.name;
  return undefined;
};

/** Compile one locale/namespace from the canonical typed registry. This keeps
 * authoring and lock-step tests in one place while emitting independent chunks
 * instead of an eager object containing every locale. */
export function buildMessageCatalogModule(locale: CatalogLocale, namespace: CatalogNamespace, source = readFileSync(sourceFile, 'utf8')): string {
  if (locale !== 'ar' && locale !== 'en') {
    const catalog = JSON.parse(readFileSync(resolve(generatedCatalogDirectory, `${locale}.json`), 'utf8')) as Record<string, string>;
    const entries = Object.entries(catalog).filter(([key]) => namespace === 'app' || isAuthMessage(key));
    return `export default ${JSON.stringify(Object.fromEntries(entries))};\n`;
  }
  const file = parse(source, { sourceType: 'module', plugins: ['typescript'] });
  let messagesObject: ObjectExpression | undefined;
  for (const statement of file.program.body) {
    const variableStatement = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
    if (variableStatement?.type !== 'VariableDeclaration') continue;
    for (const declaration of variableStatement.declarations) {
      if (declaration.id.type !== 'Identifier' || declaration.id.name !== 'messages' || !declaration.init) continue;
      let initializer: Expression = declaration.init;
      while (initializer.type === 'TSAsExpression' || initializer.type === 'TSSatisfiesExpression') {
        initializer = initializer.expression;
      }
      if (initializer.type === 'ObjectExpression') messagesObject = initializer;
    }
  }
  if (!messagesObject) throw new Error('Unable to find the messages registry.');

  const localeProperty = messagesObject.properties.find((property) => propertyName(property) === locale);
  if (localeProperty?.type !== 'ObjectProperty' || localeProperty.value.type !== 'ObjectExpression') {
    throw new Error(`Unable to find the ${locale} message catalog.`);
  }

  const properties = localeProperty.value.properties.filter((property) => {
    const key = propertyName(property);
    return namespace === 'app' || isAuthMessage(key);
  });
  return `export default {\n${properties.map((property) => source.slice(property.start ?? 0, property.end ?? 0)).join(',\n')}\n};\n`;
}

export function messageCatalogPlugin(): Plugin {
  return {
    name: 'nibleaf-message-catalogs',
    enforce: 'pre',
    resolveId(id) {
      return id.startsWith(virtualPrefix) ? `${resolvedPrefix}${id.slice(virtualPrefix.length)}` : undefined;
    },
    load(id) {
      if (!id.startsWith(resolvedPrefix)) return undefined;
      const [locale, namespace] = id.slice(resolvedPrefix.length).split('/');
      if (!catalogLocales.has(locale as CatalogLocale) || (namespace !== 'app' && namespace !== 'auth')) {
        throw new Error(`Unknown message catalog: ${id.slice(resolvedPrefix.length)}`);
      }
      return buildMessageCatalogModule(locale as CatalogLocale, namespace);
    },
  };
}
