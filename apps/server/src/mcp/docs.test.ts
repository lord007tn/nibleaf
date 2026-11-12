import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  isMcpWriteScope,
  MCP_KEY_PRESETS,
  MCP_PRESET_SCOPES,
  MCP_TOOL_SCOPES,
  type McpKeyPreset,
  type McpScope,
  type McpToolName,
} from '@nibleaf/shared/mcp';
import { describe, expect, it } from 'vitest';
import { supportPrompts } from './prompts';

// The user docs name tools and prompts by their real identifiers, state the
// least permission each example needs, and repeat the consent page's privacy
// sentence. These tests keep all three in step with the server and the UI, so
// the docs can't promise a tool, a level or a privacy guarantee that isn't real.
const root = resolve(import.meta.dirname, '../../../..');
const read = (path: string) => readFileSync(resolve(root, 'docs', path), 'utf8');
const flatten = (text: string) => text.replace(/\s+/gu, ' ');
const tools = new Set(Object.keys(MCP_TOOL_SCOPES));
const prompts = new Set<string>(supportPrompts.map(([name]) => name));
const isTool = (name: string): name is McpToolName => tools.has(name);
/** Other identifiers the docs quote: permission values and get_capabilities `kind`s. */
const values = new Set<string>([...MCP_KEY_PRESETS, 'dashboard_only']);

/** The consent page's privacy sentence: the line's text after its first sentence. */
const consentPrivacy = (locale: 'en' | 'ar') => {
  const catalog = JSON.parse(readFileSync(resolve(root, `packages/i18n/messages/${locale}.json`), 'utf8')) as Record<string, string>;
  const line = catalog.oauth_consent_can_aiconversations ?? '';
  return line.slice(line.indexOf('. ') + 2);
};

const LANGUAGES = [
  {
    code: 'en',
    guide: 'product/ai-assistants.mdx',
    reference: 'reference/mcp.mdx',
    tool: 'Tool',
    prompt: 'Prompt',
    tryAsking: 'Try asking',
    preset: { read_only: 'Read only', support_writer: 'Support writer', full_admin: 'Full admin' },
    custom: (scope: McpScope, fallback: string) => `Read only plus \`${scope}\` through a custom personal key, or ${fallback}`,
  },
  {
    code: 'ar',
    guide: 'ar/product/ai-assistants.mdx',
    reference: 'ar/reference/mcp.mdx',
    tool: 'أداة',
    prompt: 'موجّه',
    tryAsking: 'جرّب أن تسأل',
    preset: { read_only: 'القراءة فقط', support_writer: 'الكتابة والنشر بعد المراجعة', full_admin: 'صلاحيات مشرف كاملة' },
    custom: (scope: McpScope, fallback: string) => `«القراءة فقط» مع \`${scope}\` عبر مفتاح شخصي مخصّص، أو «${fallback}»`,
  },
] as const;

/**
 * The least permission that runs `needed`, as the guide must state it: Read
 * only when that covers it; Read only plus the one missing read scope through
 * a custom key (with the smallest preset as the alternative) when exactly one
 * non-write scope is missing; otherwise the smallest preset.
 */
const leastPermission = (needed: readonly McpScope[], language: (typeof LANGUAGES)[number]) => {
  const covers = (preset: McpKeyPreset) => needed.every((scope) => MCP_PRESET_SCOPES[preset].includes(scope));
  const smallest = MCP_KEY_PRESETS.find(covers) ?? 'full_admin';
  if (smallest === 'read_only') return language.preset.read_only;
  const missing = [...new Set(needed.filter((scope) => !MCP_PRESET_SCOPES.read_only.includes(scope)))];
  const [only] = missing;
  if (missing.length === 1 && only && !isMcpWriteScope(only)) return language.custom(only, language.preset[smallest]);
  return language.preset[smallest];
};

describe.each(LANGUAGES)('MCP docs ($code)', (language) => {
  const { code, guide, reference, tool, prompt, tryAsking } = language;

  it('the reference catalog lists exactly the tools the server offers, with their scopes, and its prompts', () => {
    const text = read(reference);
    const rows = [...text.matchAll(/^\| `([a-z_]+)` \| ([^|]+?) \| `([a-z_]+:[a-z_]+)`/gmu)];
    const catalog = Object.fromEntries(rows.filter((row) => row[2] === tool).map((row) => [row[1], row[3]]));
    expect(catalog).toEqual(MCP_TOOL_SCOPES);
    const listedPrompts = new Set([...text.matchAll(/^\| `([a-z_]+)` \| ([^|]+?) \|/gmu)].filter((row) => row[2] === prompt).map((row) => row[1]));
    expect(listedPrompts).toEqual(prompts);
  });

  it('names only tools and prompts that exist', () => {
    for (const path of [guide, reference]) {
      const names = [...read(path).matchAll(/`([a-z]+(?:_[a-z]+)+)`/gu)].map((match) => match[1] ?? '');
      const unknown = names.filter((name) => !tools.has(name) && !prompts.has(name) && !values.has(name));
      expect(unknown, path).toEqual([]);
    }
  });

  it('offers ten example prompts, each with real tools and the least permission the scope tables give', () => {
    const section =
      read(guide)
        .split(/^## /mu)
        .find((part) => part.startsWith(`${tryAsking}\n`)) ?? '';
    const rows = [...section.matchAll(/^\| (?!---|Ask \||اسأل \|)(.+?) \| (.+?) \| (.+?) \|$/gmu)];
    expect(rows).toHaveLength(10);
    for (const [, ask, toolCell = '', level = ''] of rows) {
      const used = [...toolCell.matchAll(/`([a-z_]+)`/gu)].map((match) => match[1] ?? '');
      expect(used.length, ask).toBeGreaterThan(0);
      for (const name of used) expect(isTool(name), name).toBe(true);
      const needed = used.filter(isTool).map((name) => MCP_TOOL_SCOPES[name]);
      expect(level.trim(), ask).toBe(leastPermission(needed, language));
    }
  });

  it("repeats the consent page's privacy sentence word for word, and promises nothing more", () => {
    const sentence = consentPrivacy(code);
    expect(sentence.length).toBeGreaterThan(20);
    for (const path of [guide, reference]) expect(flatten(read(path)), path).toContain(sentence);
  });
});
