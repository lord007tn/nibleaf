import type { DocumentationReaderTag } from '@nibleaf/shared/documentation-component-contract';
import type { ComponentProps, FunctionComponent, ReactNode } from 'react';
import { z } from 'zod';

// MDX component tags. react-markdown's Components type only knows HTML tags, so
// custom tags are typed separately and merged into the HTML component map.
export interface MdxProps {
  children?: ReactNode;
  type?: unknown;
  title?: unknown;
  href?: unknown;
  icon?: unknown;
  cols?: unknown;
  defaultopen?: unknown;
  caption?: unknown;
  tip?: unknown;
  color?: unknown;
  size?: unknown;
  label?: unknown;
  description?: unknown;
  path?: unknown;
  query?: unknown;
  header?: unknown;
  body?: unknown;
  name?: unknown;
  dataDisplayName?: unknown;
  'data-display-name'?: unknown;
  required?: unknown;
  default?: unknown;
  deprecated?: unknown;
  variant?: unknown;
  status?: unknown;
}

export type ButtonMdxProps = ComponentProps<'button'> & { href?: unknown; variant?: unknown };

/** One renderer per element the reader can meet after parsing: every registry
 *  component plus the `mermaid` element synthesized from ```mermaid fences. */
export type DocumentationComponents = Omit<Record<DocumentationReaderTag | 'mermaid', FunctionComponent<MdxProps>>, 'button'> & {
  button: FunctionComponent<ButtonMdxProps>;
};

const optionalStringSchema = z.string().optional().catch(undefined);
export const str = (value: unknown) => optionalStringSchema.parse(value);
export const authoredName = (props: MdxProps): string | undefined => str(props['data-display-name']) ?? str(props.dataDisplayName) ?? str(props.name);
