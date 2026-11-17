import { accordionSlashItems } from './accordion';
import { apiExampleSlashItems } from './api-examples';
import { basicSlashItems, dividerSlashItems } from './basic';
import { calloutSlashItems } from './callouts';
import { cardSlashItems } from './cards';
import { codeGroupSlashItems } from './code-group';
import { expandableSlashItems } from './expandable';
import { fieldSlashItems } from './fields';
import { fileTreeSlashItems } from './file-tree';
import { frameSlashItems } from './frame';
import { iconSlashItems } from './icon';
import { layoutSlashItems } from './layout';
import { mediaSlashItems } from './media';
import { relatedSlashItems } from './related';
import { stepsSlashItems } from './steps';
import { tabsSlashItems } from './tabs';
import { tooltipSlashItems } from './tooltip';
import type { SlashItem, UploadFn } from './types';
import { updateSlashItems } from './update';
import { videoSlashItems } from './video';

/** Every slash menu item in authored order; slash-command.tsx sorts them into sections.
 *  Component items are grouped by family, matching extensions/mdx/ and site/mdx/. */
export const unsortedSlashItems = (onUpload?: UploadFn): SlashItem[] => [
  ...basicSlashItems,
  ...calloutSlashItems,
  ...stepsSlashItems,
  ...cardSlashItems,
  ...tabsSlashItems,
  ...accordionSlashItems,
  ...frameSlashItems,
  ...expandableSlashItems,
  ...tooltipSlashItems,
  ...iconSlashItems,
  ...updateSlashItems,
  ...fieldSlashItems,
  ...codeGroupSlashItems,
  ...fileTreeSlashItems,
  ...apiExampleSlashItems,
  ...relatedSlashItems,
  ...layoutSlashItems,
  ...dividerSlashItems,
  ...mediaSlashItems(onUpload),
  ...videoSlashItems,
];
