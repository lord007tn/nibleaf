// @vitest-environment jsdom

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SecretInput } from './secret-input';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const roots: Array<ReturnType<typeof createRoot>> = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
});

async function render(element: React.ReactElement) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(element));
  return container;
}

describe('SecretInput', () => {
  it('is never a password field, so browsers do not fill or save a sign-in into it', async () => {
    const container = await render(
      <form>
        <input name="slack-integration-label" />
        <SecretInput name="slack-webhook-url" />
      </form>,
    );
    const input = container.querySelector<HTMLInputElement>('input[name="slack-webhook-url"]');
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(input?.type).toBe('text');
    expect(input?.autocomplete).toBe('off');
    expect(input?.getAttribute('data-1p-ignore')).toBe('true');
    expect(input?.getAttribute('data-lpignore')).toBe('true');
    expect(input?.getAttribute('spellcheck')).toBe('false');
  });

  it('masks the value until revealed', async () => {
    const masked = await render(<SecretInput name="ai-provider-api-key" />);
    expect(masked.querySelector('input')?.className).toContain('[-webkit-text-security:disc]');
    const shown = await render(<SecretInput masked={false} name="git-webhook-secret" />);
    expect(shown.querySelector('input')?.className).not.toContain('-webkit-text-security');
  });
});

// Browsers treat a text field followed by a password field as a sign-in form
// and fill the saved email and password into it, whatever `autoComplete` says.
// Dashboard forms hold tokens, keys and webhook URLs, never the person's own
// password, so none of them may use a password-type field. Sign-in pages are
// the only exception, and today they are passwordless.
describe('dashboard forms', () => {
  const root = resolve(process.cwd(), 'src');
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return files(path);
      return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
    });

  it('never render a password-type input', () => {
    const offenders = files(root)
      .filter((path) => !relative(root, path).startsWith(join('routes', '(auth)')))
      .filter((path) => /type=(?:"password"|\{[^}]*['"]password['"])/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(root, path));
    expect(offenders).toEqual([]);
  });
});
