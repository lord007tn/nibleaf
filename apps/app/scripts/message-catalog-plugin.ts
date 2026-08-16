import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import type { Plugin } from 'vite';

const virtualPrefix = 'virtual:nibleaf-messages/';
const resolvedPrefix = `\0${virtualPrefix}`;
const sourceFile = resolve(import.meta.dirname, '../src/lib/i18n/messages.ts');

type CatalogNamespace = 'app' | 'auth';
type CatalogLocale = 'ar' | 'en';

const propertyName = (property: ts.ObjectLiteralElementLike): string | undefined => {
  const name = property.name;
  if (!name) return undefined;
  if (ts.isStringLiteral(name) || ts.isIdentifier(name)) return name.text;
  return undefined;
};

/** Compile one locale/namespace from the canonical typed registry. This keeps
 * authoring and lock-step tests in one place while emitting independent chunks
 * instead of an eager object containing every locale. */
export function buildMessageCatalogModule(locale: CatalogLocale, namespace: CatalogNamespace, source = readFileSync(sourceFile, 'utf8')): string {
  const file = ts.createSourceFile('messages.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let messagesObject: ts.ObjectLiteralExpression | undefined;
  file.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) return;
    for (const declaration of node.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === 'messages' && declaration.initializer) {
        let initializer: ts.Expression = declaration.initializer;
        if (ts.isAsExpression(initializer)) initializer = initializer.expression;
        if (ts.isObjectLiteralExpression(initializer)) messagesObject = initializer;
      }
    }
  });
  if (!messagesObject) throw new Error('Unable to find the messages registry.');

  const localeProperty = messagesObject.properties.find((property) => propertyName(property) === locale);
  if (!localeProperty || !ts.isPropertyAssignment(localeProperty) || !ts.isObjectLiteralExpression(localeProperty.initializer)) {
    throw new Error(`Unable to find the ${locale} message catalog.`);
  }

  const properties = localeProperty.initializer.properties.filter((property) => {
    const key = propertyName(property);
    return namespace === 'app' || Boolean(key?.startsWith('common.') || key?.startsWith('auth.'));
  });
  return `export default {\n${properties.map((property) => property.getText(file)).join(',\n')}\n};\n`;
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
      if ((locale !== 'ar' && locale !== 'en') || (namespace !== 'app' && namespace !== 'auth')) {
        throw new Error(`Unknown message catalog: ${id.slice(resolvedPrefix.length)}`);
      }
      return buildMessageCatalogModule(locale, namespace);
    },
  };
}
