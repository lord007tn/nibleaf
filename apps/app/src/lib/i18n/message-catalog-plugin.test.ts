import { describe, expect, it } from 'vitest';
import { buildMessageCatalogModule } from '../../../scripts/message-catalog-plugin';

describe('message catalog compiler', () => {
  it('keeps auth/common messages and excludes dashboard namespaces', () => {
    const catalog = buildMessageCatalogModule('en', 'auth');
    expect(catalog).toContain("'auth.signIn.subtitle'");
    expect(catalog).toContain("'common.cancel'");
    expect(catalog).not.toContain("'editor.title'");
    expect(catalog).not.toContain("'analytics.title'");
  });

  it('emits only the requested locale', () => {
    const english = buildMessageCatalogModule('en', 'auth');
    const arabic = buildMessageCatalogModule('ar', 'auth');
    expect(english).toContain('Sign in');
    expect(english).not.toContain('تسجيل الدخول');
    expect(arabic).toContain('تسجيل الدخول');
    expect(arabic).not.toContain('Sign in');
  });
});
