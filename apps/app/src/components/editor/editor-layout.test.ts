import { describe, expect, it } from 'vitest';
import { type EditorLayoutInput, resolveEditorLayout } from './editor-layout';

const base: EditorLayoutInput = {
  view: 'content',
  mode: 'visual',
  hasPage: true,
  sidebarCollapsed: false,
  railOpen: false,
  focusedTreeOpen: false,
};

describe('resolveEditorLayout', () => {
  it('shows the page tree and keeps the rail closed by default in a visual mode', () => {
    expect(resolveEditorLayout(base)).toEqual({
      markdownFocused: false,
      navigationCollapsed: false,
      treeOverlay: false,
      navigationHidden: false,
      showRail: false,
    });
  });

  it('opens the rail only when the author asked for it and a page is loaded', () => {
    expect(resolveEditorLayout({ ...base, railOpen: true }).showRail).toBe(true);
    expect(resolveEditorLayout({ ...base, railOpen: true, hasPage: false }).showRail).toBe(false);
    expect(resolveEditorLayout({ ...base, railOpen: true, view: 'config' }).showRail).toBe(false);
  });

  it('hides the tree and the rail in the focused Markdown layout', () => {
    const layout = resolveEditorLayout({ ...base, mode: 'markdown', railOpen: true });
    expect(layout.markdownFocused).toBe(true);
    expect(layout.navigationCollapsed).toBe(true);
    expect(layout.navigationHidden).toBe(true);
    expect(layout.treeOverlay).toBe(false);
    expect(layout.showRail).toBe(false);
  });

  it('is not focused without a loaded page or outside the content view', () => {
    expect(resolveEditorLayout({ ...base, mode: 'markdown', hasPage: false }).markdownFocused).toBe(false);
    expect(resolveEditorLayout({ ...base, mode: 'markdown', view: 'config' }).markdownFocused).toBe(false);
  });

  it('floats the tree over the canvas when requested in Markdown mode, without reclaiming the column', () => {
    const layout = resolveEditorLayout({ ...base, mode: 'markdown', focusedTreeOpen: true });
    expect(layout.treeOverlay).toBe(true);
    expect(layout.navigationHidden).toBe(false);
    // The grid column stays collapsed: the overlay is absolutely positioned.
    expect(layout.navigationCollapsed).toBe(true);
    expect(layout.showRail).toBe(false);
  });

  it('shows the overlay even when the author had collapsed the sidebar', () => {
    const layout = resolveEditorLayout({ ...base, mode: 'markdown', sidebarCollapsed: true, focusedTreeOpen: true });
    expect(layout.treeOverlay).toBe(true);
    expect(layout.navigationHidden).toBe(false);
  });

  it('ignores a stale overlay request outside the focused layout', () => {
    const layout = resolveEditorLayout({ ...base, focusedTreeOpen: true });
    expect(layout.treeOverlay).toBe(false);
    expect(layout.navigationCollapsed).toBe(false);
    expect(layout.navigationHidden).toBe(false);
  });

  it('collapses the tree column when the author collapsed the sidebar', () => {
    const layout = resolveEditorLayout({ ...base, sidebarCollapsed: true });
    expect(layout.navigationCollapsed).toBe(true);
    expect(layout.navigationHidden).toBe(true);
    expect(layout.treeOverlay).toBe(false);
  });
});
