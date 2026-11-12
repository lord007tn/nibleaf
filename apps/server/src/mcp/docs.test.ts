import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MCP_KEY_PRESETS, MCP_PRESET_SCOPES, MCP_TOOL_SCOPES, type McpKeyPreset, type McpToolName } from '@nibleaf/shared/mcp';
import { describe, expect, it } from 'vitest';
import { supportPrompts } from './prompts';

// The user docs name tools and prompts by their real identifiers. These tests
// keep them in step with the server, so a renamed or removed tool can't leave
// the guide or the reference promising something that doesn't exist.
const docs = resolve(import.meta.dirname, '../../../../docs');
const read = (path: string) => readFileSync(resolve(docs, path), 'utf8');
const tools = new Set(Object.keys(MCP_TOOL_SCOPES));
const prompts = new Set<string>(supportPrompts.map(([name]) => name));
const isTool = (name: string): name is McpToolName => tools.has(name);
/** Other identifiers the docs quote: permission values and get_capabilities `kind`s. */
const values = new Set<string>([...MCP_KEY_PRESETS, 'dashboard_only']);

const LANGUAGES = [
  { code: 'en', guide: 'product/ai-assistants.mdx', reference: 'reference/mcp.mdx', tool: 'Tool', prompt: 'Prompt', tryAsking: 'Try asking' },
  { code: 'ar', guide: 'ar/product/ai-assistants.mdx', reference: 'ar/reference/mcp.mdx', tool: 'أداة', prompt: 'موجّه', tryAsking: 'جرّب أن تسأل' },
] as const;

/** The level names the guide's "Needs" column uses, per language. */
const PRESET_LABELS: Record<string, McpKeyPreset> = {
  'Read only': 'read_only',
  'Support writer': 'support_writer',
  'القراءة فقط': 'read_only',
  'الكتابة والنشر بعد المراجعة': 'support_writer',
};

describe.each(LANGUAGES)('MCP docs ($code)', ({ guide, reference, tool, prompt, tryAsking }) => {
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

  it('offers ten example prompts, each leading to real tools that its stated level can use', () => {
    const section =
      read(guide)
        .split(/^## /mu)
        .find((part) => part.startsWith(`${tryAsking}\n`)) ?? '';
    const rows = [...section.matchAll(/^\| (?!---|Ask \||اسأل \|)(.+?) \| (.+?) \| (.+?) \|$/gmu)];
    expect(rows).toHaveLength(10);
    for (const [, ask, toolCell = '', level = ''] of rows) {
      const used = [...toolCell.matchAll(/`([a-z_]+)`/gu)].map((match) => match[1] ?? '');
      expect(used.length, ask).toBeGreaterThan(0);
      const preset = PRESET_LABELS[level.trim()];
      expect(preset, `${ask}: "${level}"`).toBeDefined();
      for (const name of used) {
        expect(isTool(name), name).toBe(true);
        if (isTool(name) && preset) expect(MCP_PRESET_SCOPES[preset], `${ask}: ${name}`).toContain(MCP_TOOL_SCOPES[name]);
      }
    }
  });
});
