/** @vitest-environment jsdom */
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@/hooks/api/types';
import { SeoSection } from './seo-section';
import { ConfigDirtyProvider } from './shared';

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn((_value, options) => options?.onSuccess?.()) }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key, translateFn: (key: string) => key }));
vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/hooks/api', () => ({
  useLanguages: () => ({ data: [] }),
  useUpdateProjectConfig: () => ({ mutate }),
  useUpdateLanguage: () => ({ mutateAsync: vi.fn() }),
  useUploadAsset: () => ({ mutateAsync: vi.fn() }),
}));

describe('default SEO clearing', () => {
  afterEach(() => vi.clearAllMocks());

  it('sends explicit empty fields over JSON when existing SEO values are cleared', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const project = {
      id: 'project-a',
      config: { seo: { metaTitle: 'Old title', metaDescription: 'Old description', socialImage: 'https://example.com/old.png' } },
    } as Project;
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<SeoSection project={project} />));
      const controls = container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        'input:not([type="file"]):not([type="checkbox"]):not([type="hidden"]), textarea',
      );
      expect(controls).toHaveLength(3);
      await act(async () => {
        for (const control of controls) {
          const prototype = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(control, '');
          control.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
      const form = container.querySelector('form');
      if (!form) throw new Error('SEO form was not rendered');
      await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      expect(mutate).toHaveBeenCalledOnce();
      const request = JSON.parse(JSON.stringify(mutate.mock.calls[0]?.[0]));
      expect(request.config.seo).toEqual({ metaTitle: '', metaDescription: '', socialImage: '', allowIndex: true });
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('reports unsaved config centrally and clears the guard after save or undo', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const dirty = new Set<string>();
    const report = (source: string, changed: boolean) => {
      if (changed) dirty.add(source);
      else dirty.delete(source);
    };
    const initial = { id: 'project-a', config: { seo: { metaTitle: 'Saved title' } } } as Project;
    function ConnectedSection() {
      const [project, setProject] = useState(initial);
      mutate.mockImplementation((request, options) => {
        setProject({ ...project, config: { ...project.config, seo: request.config.seo } });
        queueMicrotask(() => options?.onSuccess?.());
      });
      return (
        <ConfigDirtyProvider report={report}>
          <SeoSection project={project} />
        </ConfigDirtyProvider>
      );
    }
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<ConnectedSection />));
      expect(dirty.size).toBe(0);
      const title = container.querySelector<HTMLInputElement>('input:not([type="file"]):not([type="checkbox"])');
      if (!title) throw new Error('SEO title was not rendered');
      const changeTitle = async (value: string) =>
        act(async () => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(title, value);
          title.dispatchEvent(new Event('input', { bubbles: true }));
        });
      await changeTitle('Unsaved title');
      expect(dirty.size).toBeGreaterThan(0);
      await changeTitle('Saved title');
      expect(dirty.size).toBe(0);
      await changeTitle('New saved title');
      const form = container.querySelector('form');
      if (!form) throw new Error('SEO form was not rendered');
      await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      expect(dirty.size).toBe(0);
      const save = container.querySelector<HTMLButtonElement>('button[type="submit"]');
      expect(save?.disabled).toBe(true);
      // Reverting to the value present when the form first mounted must remain
      // an edit after a different value has already been saved successfully.
      await changeTitle('Saved title');
      expect(save?.disabled).toBe(false);
      expect(dirty.size).toBeGreaterThan(0);
      await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      expect(mutate.mock.calls.at(-1)?.[0]?.config.seo.metaTitle).toBe('Saved title');
      expect(dirty.size).toBe(0);
      await changeTitle('Another unsaved title');
      expect(dirty.size).toBeGreaterThan(0);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
    expect(dirty.size).toBe(0);
  });
});
