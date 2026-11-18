// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const downloads = vi.hoisted(() => ({ arabic: vi.fn(), german: vi.fn() }));
vi.mock('./generated/dashboard/messages/ar.js', () => downloads.arabic());
vi.mock('./generated/dashboard/messages/de.js', () => downloads.german());

beforeEach(() => {
  vi.resetModules();
  downloads.arabic.mockReset();
  downloads.german.mockReset();
  document.documentElement.setAttribute('data-locale', 'en');
});

describe('dashboard catalog downloads', () => {
  it('keeps scoped-only language changes free of catalog downloads after leaving the dashboard', async () => {
    const { configureDashboardLocaleLoading } = await import('./dashboard-catalog.client');
    const load = vi.fn((importer: () => Promise<unknown>) => importer());
    configureDashboardLocaleLoading(load, () => false);
    const { getLocale, setLanguage } = await import('./runtime');
    await setLanguage('ar');
    expect(getLocale()).toBe('ar');
    expect(load).not.toHaveBeenCalled();
  });

  it('keeps English for a deleted key while loading only the requested catalog', async () => {
    downloads.arabic.mockResolvedValue({ common_cancel: () => 'fixture Arabic', common_save: () => 'fixture save' });
    const { dashboardMessage, prepareDashboardLocale, configureDashboardLocaleLoading } = await import('./dashboard-catalog.client');
    configureDashboardLocaleLoading(async (importer) => {
      // Vitest's namespace proxy throws on absent exports; a real module returns
      // undefined. Delete from a plain catalog to exercise that real boundary.
      const arabic = { ...((await importer()) as Record<string, () => string>) };
      delete arabic.common_save;
      return arabic;
    });
    expect(downloads.arabic).not.toHaveBeenCalled();
    expect(await prepareDashboardLocale('ar')).toBe(true);
    expect(dashboardMessage('common_cancel', 'ar')?.()).toBe('fixture Arabic');
    expect(dashboardMessage('common_save', 'ar')?.()).toBe('Save changes');
    expect(downloads.arabic).toHaveBeenCalledTimes(1);
    expect(downloads.german).not.toHaveBeenCalled();
  });

  it('keeps the active language and text after failure, and retries an explicit choice', async () => {
    downloads.arabic.mockResolvedValue({ common_cancel: () => 'fixture Arabic' });
    const { dashboardMessage, configureDashboardLocaleLoading } = await import('./dashboard-catalog.client');
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('fixture offline'))
      .mockImplementation((importer: () => Promise<unknown>) => importer());
    configureDashboardLocaleLoading(load);
    const { getLocale, setLanguage } = await import('./runtime');
    await setLanguage('ar');
    expect(getLocale()).toBe('en');
    expect(dashboardMessage('common_cancel', 'ar')?.()).toBe('Cancel');
    await setLanguage('ar');
    expect(getLocale()).toBe('ar');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('keeps readable English on an unavailable first-load catalog and retries the same server locale', async () => {
    document.documentElement.setAttribute('data-locale', 'ar');
    document.documentElement.lang = 'ar';
    downloads.arabic.mockResolvedValue({ common_cancel: () => 'fixture Arabic' });
    const { dashboardMessage, prepareDashboardLocale, configureDashboardLocaleLoading } = await import('./dashboard-catalog.client');
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('fixture unavailable'))
      .mockImplementation((importer: () => Promise<unknown>) => importer());
    configureDashboardLocaleLoading(load);
    expect(await prepareDashboardLocale('ar')).toBe(false);
    expect(dashboardMessage('common_cancel', 'ar')?.()).toBe('Cancel');
    const { setLanguage, renderedLocale, subscribeLanguage } = await import('./runtime');
    const changed = vi.fn();
    const unsubscribe = subscribeLanguage(changed);
    await setLanguage('ar');
    expect(renderedLocale()).toBe('ar');
    expect(dashboardMessage('common_cancel', 'ar')?.()).toBe('fixture Arabic');
    expect(changed).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('reports a failed language choice once, and only for the latest choice', async () => {
    downloads.german.mockResolvedValue({ common_cancel: () => 'fixture German' });
    const { configureDashboardLocaleLoading } = await import('./dashboard-catalog.client');
    let failArabic!: (error: Error) => void;
    configureDashboardLocaleLoading(
      vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((_resolve, reject) => {
              failArabic = reject;
            }),
        )
        .mockImplementationOnce((importer: () => Promise<unknown>) => importer())
        .mockRejectedValueOnce(new Error('fixture offline')),
    );
    const { getLocale, setLanguage, subscribeLanguageFailure } = await import('./runtime');
    const failed = vi.fn();
    const unsubscribe = subscribeLanguageFailure(failed);
    const superseded = setLanguage('ar');
    await setLanguage('de');
    failArabic(new Error('fixture offline'));
    await superseded;
    expect(failed).not.toHaveBeenCalled();
    expect(getLocale()).toBe('de');
    await setLanguage('fr');
    expect(failed).toHaveBeenCalledExactlyOnceWith('fr');
    expect(getLocale()).toBe('de');
    unsubscribe();
  });

  it('skips the optional-load exemption for a catalog the page needs to render', async () => {
    downloads.arabic.mockResolvedValue({ common_cancel: () => 'fixture Arabic' });
    const { dashboardMessage, prepareDashboardLocale, configureDashboardLocaleLoading } = await import('./dashboard-catalog.client');
    const optional = vi.fn((importer: () => Promise<unknown>) => importer());
    configureDashboardLocaleLoading(optional);
    expect(await prepareDashboardLocale('ar', { required: true })).toBe(true);
    expect(optional).not.toHaveBeenCalled();
    expect(dashboardMessage('common_cancel', 'ar')?.()).toBe('fixture Arabic');
  });

  it('applies only the latest choice when downloads finish out of order', async () => {
    let finishArabic!: (catalog: Record<string, () => string>) => void;
    downloads.german.mockResolvedValue({ common_cancel: () => 'fixture German' });
    const { configureDashboardLocaleLoading } = await import('./dashboard-catalog.client');
    configureDashboardLocaleLoading(
      vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finishArabic = resolve;
            }),
        )
        .mockImplementation((importer: () => Promise<unknown>) => importer()),
    );
    const { getLocale, setLanguage } = await import('./runtime');
    const arabic = setLanguage('ar');
    await setLanguage('de');
    finishArabic({ common_cancel: () => 'fixture Arabic' });
    await arabic;
    expect(getLocale()).toBe('de');
    expect(document.documentElement.lang).toBe('de');
  });
});
