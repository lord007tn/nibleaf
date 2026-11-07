import { Accordion, AccordionGroup } from './accordion';
import { ApiExample, RequestExample, ResponseExample } from './api-examples';
import { Card, CardGroup } from './cards';
import { CodeGroup } from './code-group';
import { Expandable, ParamField, ResponseField } from './fields';
import { File, FileTree, Folder } from './file-tree';
import { Frame } from './frame';
import { Icon } from './icon';
import { Badge, Banner, Column, Columns, MdxButton } from './layout';
import { RelatedCard, RelatedContent } from './related';
import { Step, Steps } from './steps';
import { Tab, Tabs } from './tabs';
import { Tooltip } from './tooltip';
import { Update } from './update';

/** All MDX component nodes, for the editor's extension list. Modeling every
 *  renderer-supported component here is what keeps the editor↔live-site round-trip
 *  lossless — an unmodeled tag would be silently dropped on the next save.
 *  Callout variants are the separate `callout` extension (../callout.ts). */
export const mdxNodes = [
  Steps,
  Step,
  CardGroup,
  Card,
  Tabs,
  Tab,
  AccordionGroup,
  Accordion,
  Frame,
  Expandable,
  Update,
  FileTree,
  Folder,
  File,
  ApiExample,
  RequestExample,
  ResponseExample,
  RelatedContent,
  RelatedCard,
  ParamField,
  ResponseField,
  CodeGroup,
  Columns,
  Column,
  Banner,
  Badge,
  MdxButton,
  Tooltip,
  Icon,
];
