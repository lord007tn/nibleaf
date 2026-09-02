/** Which parts of the editor chrome are on screen for a given view, content mode
 *  and panel state. Kept pure so the focused-Markdown rules (tree hidden, but
 *  reachable as a temporary overlay) and the rail default can be unit-tested
 *  without mounting the editor. */
export interface EditorLayoutInput {
  /** Top-level editor view: writing content vs. configuring the whole site. */
  view: 'content' | 'config';
  mode: 'visual' | 'wysiwyg' | 'markdown';
  /** A page is selected and loaded into the canvas. */
  hasPage: boolean;
  /** The author's persisted "collapse the page tree" choice. */
  sidebarCollapsed: boolean;
  /** The author's persisted "show the comments/AI rail" choice. */
  railOpen: boolean;
  /** The page tree was requested as a temporary overlay in the focused layout. */
  focusedTreeOpen: boolean;
}

export interface EditorLayout {
  /** Raw Markdown is a focused workspace: the tree and rail leave the grid. */
  markdownFocused: boolean;
  /** The page-tree column is removed from the grid (0px wide). */
  navigationCollapsed: boolean;
  /** The page tree floats over the canvas instead of occupying a column. */
  treeOverlay: boolean;
  /** Nothing of the page tree is visible or interactive. */
  navigationHidden: boolean;
  showRail: boolean;
}

export const resolveEditorLayout = ({ view, mode, hasPage, sidebarCollapsed, railOpen, focusedTreeOpen }: EditorLayoutInput): EditorLayout => {
  const markdownFocused = view === 'content' && mode === 'markdown' && hasPage;
  const navigationCollapsed = sidebarCollapsed || markdownFocused;
  // The overlay never touches the persisted collapsed state: it only exists while
  // the focused layout hides the tree, and it goes away with that layout.
  const treeOverlay = markdownFocused && focusedTreeOpen;
  return {
    markdownFocused,
    navigationCollapsed,
    treeOverlay,
    navigationHidden: navigationCollapsed && !treeOverlay,
    showRail: view === 'content' && railOpen && !markdownFocused && hasPage,
  };
};
