import { atomNode, containerNode, titledNode } from './factories';

// ─── Authored file tree (names are display data, never filesystem paths) ─────
export const FileTree = containerNode({
  name: 'mdxFileTree',
  tag: 'FileTree',
  content: '(mdxFolder | mdxFile)+',
  className: 'pl-filetree',
});
export const Folder = titledNode({
  name: 'mdxFolder',
  tag: 'Folder',
  className: 'pl-folder',
});
export const File = atomNode({
  name: 'mdxFile',
  tag: 'File',
  className: 'pl-file',
});
