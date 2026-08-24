// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectAddon } from '@/hooks/api/types';
import { AddonsSection } from './addons-section';

const translations: Record<string, string> = {
  'settings.addons.feedback.placement': 'الموضع',
  'settings.addons.feedback.placement.afterContent': 'بعد محتوى الصفحة',
  'settings.addons.feedback.placement.afterNavigation': 'بعد روابط السابق والتالي',
  'settings.addons.feedback.presentation': 'طريقة العرض',
  'settings.addons.feedback.presentation.compact': 'صف مدمج',
  'settings.addons.feedback.presentation.card': 'بطاقة',
  'settings.addons.consent.placement': 'موضع البطاقة',
  'settings.addons.consent.placement.start': 'أسفل البداية',
  'settings.addons.consent.placement.center': 'أسفل الوسط',
  'settings.addons.consent.placement.end': 'أسفل النهاية',
  'settings.addons.consent.presentation': 'كثافة البطاقة',
  'settings.addons.consent.presentation.compact': 'مدمجة',
  'settings.addons.consent.presentation.comfortable': 'مريحة',
  'settings.addons.consent.buttons': 'تخطيط الإجراءات',
  'settings.addons.consent.buttons.inline': 'جنبًا إلى جنب',
  'settings.addons.consent.buttons.stacked': 'مكدّسة',
  'settings.addons.group.engagement.title': 'تفاعل القرّاء',
  'settings.addons.group.privacy.title': 'الخصوصية والموافقة',
  'settings.addons.group.publishing.title': 'سير عمل النشر',
};

const mutation = { isPending: false, mutate: vi.fn() };
const availability = {
  state: 'available',
  plans: ['free'],
  available: true,
  schemaVersion: 1,
  projectId: 'project-a',
  availability: 'complete',
  decision: 'enabled',
  planKey: 'free',
  source: 'plan',
  limit: null,
  meterKey: null,
  behavior: 'observe',
  enforcement: 'advisory',
} as const;
const addons = [
  {
    id: 'feedback',
    group: 'engagement',
    enabled: true,
    config: { placement: 'after-content', presentation: 'card' },
    revision: 1,
    updatedAt: null,
    status: 'active',
    availability: { ...availability, entitlement: 'addons.feedback', capabilityKey: 'addons.feedback' },
  },
  {
    id: 'consent-banner',
    group: 'privacy',
    enabled: true,
    config: { placement: 'bottom-end', presentation: 'comfortable', buttonLayout: 'inline' },
    revision: 1,
    updatedAt: null,
    status: 'active',
    availability: { ...availability, entitlement: 'addons.consent-banner', capabilityKey: 'addons.consent-banner' },
  },
] satisfies ProjectAddon[];

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => translations[key] ?? key }));
vi.mock('@/hooks/api', () => ({
  useProjectAddons: () => ({ data: addons, isLoading: false, isError: false, refetch: vi.fn() }),
  useUpdateProjectAddon: () => mutation,
  useActivateProjectAddon: () => mutation,
  useDeactivateProjectAddon: () => mutation,
}));

describe('AddonsSection localized select values', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div');
    container.dir = 'rtl';
    document.body.append(container);
  });

  afterEach(() => {
    container.remove();
    vi.clearAllMocks();
  });

  it('renders Arabic labels instead of raw add-on enum tokens', async () => {
    const root = createRoot(container);
    await act(async () => root.render(createElement(AddonsSection, { projectId: 'project-a' })));

    expect(container.textContent).toContain('بعد محتوى الصفحة');
    expect(container.textContent).toContain('بطاقة');
    expect(container.textContent).not.toContain('after-content');

    const privacy = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('الخصوصية والموافقة'));
    await act(async () => privacy?.click());

    expect(container.textContent).toContain('أسفل النهاية');
    expect(container.textContent).toContain('مريحة');
    expect(container.textContent).toContain('جنبًا إلى جنب');
    expect(container.textContent).not.toMatch(/bottom-end|comfortable|inline/);

    act(() => root.unmount());
  });
});
