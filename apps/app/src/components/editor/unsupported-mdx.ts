/**
 * Capability inventory for the editor UX. Unknown components are no longer a
 * page-wide error: the MDX source adapter represents each one as an opaque node
 * while supported content around it remains editable.
 */
import { findUnsupportedMdxComponents } from './extensions/mdx-roundtrip';

/** Unknown component names, once each and in source order. */
export const detectUnsupportedMdxTags = findUnsupportedMdxComponents;
