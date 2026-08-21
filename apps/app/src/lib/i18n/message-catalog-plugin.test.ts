import { describe, expect, it } from 'vitest';
import { buildMessageCatalogModule } from '../../../scripts/message-catalog-plugin';

describe('message catalog compiler', () => {
  it('keeps auth/common messages and excludes dashboard namespaces', () => {
    const catalog = buildMessageCatalogModule('en', 'auth');
    expect(catalog).toContain("'auth.signIn.subtitle'");
    expect(catalog).toContain("'common.cancel'");
    expect(catalog).toContain("'account.language'");
    expect(catalog).not.toContain("'editor.title'");
    expect(catalog).not.toContain("'analytics.title'");
  });

  it('emits only the requested locale', () => {
    const english = buildMessageCatalogModule('en', 'auth');
    const arabic = buildMessageCatalogModule('ar', 'auth');
    expect(english).toContain("'auth.signIn.submit': 'Log in'");
    expect(english).toContain("'auth.google.signIn': 'Log in with Google'");
    expect(english).not.toContain("'auth.signIn.submit': 'تسجيل الدخول'");
    expect(english).not.toContain("'auth.google.signIn': 'تسجيل الدخول باستخدام Google'");
    expect(arabic).toContain("'auth.signIn.submit': 'تسجيل الدخول'");
    expect(arabic).toContain("'auth.google.signIn': 'تسجيل الدخول باستخدام Google'");
    expect(arabic).not.toContain("'auth.signIn.submit': 'Log in'");
    expect(arabic).not.toContain("'auth.google.signIn': 'Log in with Google'");
  });

  it('builds a namespace-filtered generated locale catalog', () => {
    const spanish = buildMessageCatalogModule('es', 'auth');
    expect(spanish).toContain('Iniciar sesión');
    expect(spanish).toContain('auth.signIn.subtitle');
    expect(spanish).not.toContain('analytics.title');
  });
});
