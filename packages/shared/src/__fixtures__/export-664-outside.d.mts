import type { Token } from 'markdown-it';
import type { ExportStructure } from '../export-structure';
export function checkOutside(model: ExportStructure, output: string, before: Token[], after: Token[], decode: (source: string) => string): boolean;
