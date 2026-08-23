import {
  inspectThemeTemplateInput,
  resolveTheme,
  THEME_COLOR_KEYS,
  THEME_PRESET_IDS,
  THEME_SCHEMA_VERSION,
  THEME_TEMPLATE_KIND,
  type ThemeTemplateV1,
  themeContrastIssues,
} from '@nibleaf/shared/themes';
import { z } from 'zod';

const hexColor = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Use a hex color such as #2368c4.');
const metadataSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(240),
    author: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

const colorShape = Object.fromEntries(THEME_COLOR_KEYS.map((key) => [key, hexColor.optional()])) as Record<
  (typeof THEME_COLOR_KEYS)[number],
  z.ZodOptional<typeof hexColor>
>;
const themeModeColorsSchema = z.object(colorShape).strict();

export const themeConfigSchema = z
  .object({
    version: z.literal(THEME_SCHEMA_VERSION).optional(),
    preset: z.enum(THEME_PRESET_IDS).optional(),
    metadata: metadataSchema.optional(),
    colors: z.object({ light: themeModeColorsSchema.optional(), dark: themeModeColorsSchema.optional() }).strict().optional(),
    layout: z
      .object({
        shell: z.enum(['reference', 'editorial', 'console']).optional(),
        density: z.enum(['compact', 'comfortable', 'relaxed']).optional(),
        radius: z.enum(['sharp', 'rounded', 'pill']).optional(),
        contentWidth: z.enum(['focused', 'balanced', 'wide']).optional(),
        header: z.enum(['inline', 'stacked', 'floating']).optional(),
        sidebar: z.enum(['bordered', 'soft', 'rail']).optional(),
        navigation: z.enum(['tree', 'sectioned', 'compact']).optional(),
      })
      .strict()
      .optional(),
    components: z
      .object({
        codeBlocks: z.enum(['system', 'dim', 'vivid']).optional(),
        callouts: z.enum(['soft', 'outline', 'solid']).optional(),
        cards: z.enum(['bordered', 'lifted', 'flat']).optional(),
        tabs: z.enum(['underline', 'pills', 'boxed']).optional(),
        tables: z.enum(['lines', 'rows', 'cards']).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((theme, ctx) => {
    for (const issue of themeContrastIssues(resolveTheme({ theme }))) {
      ctx.addIssue({
        code: 'custom',
        path: ['colors', issue.mode],
        message: `${issue.pair} contrast is ${issue.ratio.toFixed(2)}:1; ${issue.required}:1 is required.`,
      });
    }
  });

const safeRootRelativeReference = (value: string): boolean => {
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return false;
  let path = value.split(/[?#]/, 1)[0] ?? '';
  for (let pass = 0; pass < 2; pass += 1) {
    try {
      path = decodeURIComponent(path);
    } catch {
      return false;
    }
    if (path.includes('\\') || path.split('/').includes('..')) return false;
  }
  return true;
};

const safeAssetReference = z
  .string()
  .trim()
  .max(500)
  .refine(
    (value) => {
      if (safeRootRelativeReference(value)) return true;
      try {
        const parsed = new URL(value);
        return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
      } catch {
        return false;
      }
    },
    { message: 'Assets must use an HTTPS URL or a root-relative path without traversal.' },
  );

const safeNavigationReference = z
  .string()
  .trim()
  .max(500)
  .refine((value) => {
    if (safeRootRelativeReference(value)) return true;
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
    } catch {
      return false;
    }
  }, 'Logo destination must be an HTTPS URL without credentials or a root-relative path.');

const templateConfigSchema = z
  .object({
    theme: themeConfigSchema.optional(),
    styling: z
      .object({
        primaryColor: hexColor.optional(),
        theme: z.enum(['light', 'dark', 'system']).optional(),
        radius: z.enum(['sharp', 'rounded', 'pill']).optional(),
      })
      .strict()
      .optional(),
    typography: z
      .object({
        headingFont: z
          .string()
          .trim()
          .min(1)
          .max(60)
          .regex(/^[\p{L}\p{N} ._-]+$/u)
          .optional(),
        bodyFont: z
          .string()
          .trim()
          .min(1)
          .max(60)
          .regex(/^[\p{L}\p{N} ._-]+$/u)
          .optional(),
        codeFont: z
          .string()
          .trim()
          .min(1)
          .max(60)
          .regex(/^[\p{L}\p{N} ._-]+$/u)
          .optional(),
        baseSize: z.enum(['14', '15', '16', '17', '18']).optional(),
        leading: z.enum(['1.5', '1.6', '1.75', '1.9', '2']).optional(),
        flow: z.enum(['0.75', '1', '1.25', '1.5', '2']).optional(),
      })
      .strict()
      .optional(),
    branding: z
      .object({
        logoLight: safeAssetReference.nullable().optional(),
        logoDark: safeAssetReference.nullable().optional(),
        favicon: safeAssetReference.nullable().optional(),
        logoHref: safeNavigationReference.nullable().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const themeTemplateV1Schema = z
  .object({
    kind: z.literal(THEME_TEMPLATE_KIND),
    version: z.literal(THEME_SCHEMA_VERSION),
    metadata: metadataSchema,
    config: templateConfigSchema,
  })
  .strict()
  .superRefine((template, ctx) => {
    for (const issue of themeContrastIssues(resolveTheme(template.config))) {
      ctx.addIssue({
        code: 'custom',
        path: ['config', 'theme', 'colors', issue.mode],
        message: `${issue.pair} contrast is ${issue.ratio.toFixed(2)}:1; ${issue.required}:1 is required.`,
      });
    }
  });

const legacyThemeTemplateV0Schema = z
  .object({
    kind: z.literal(THEME_TEMPLATE_KIND),
    version: z.literal(0),
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(240).optional(),
    author: z.string().trim().min(1).max(80).optional(),
    preset: z.enum(THEME_PRESET_IDS).optional(),
    primaryColor: hexColor.optional(),
    appearance: z.enum(['light', 'dark', 'system']).optional(),
    radius: z.enum(['sharp', 'rounded', 'pill']).optional(),
  })
  .strict();

export const themeImportBodySchema = z
  .object({
    template: z.unknown(),
    mode: z.enum(['merge', 'replace']),
    apply: z.boolean().default(false),
  })
  .strict();
export type ThemeImportBody = z.infer<typeof themeImportBodySchema>;

export type ThemeTemplateParseResult =
  | { success: true; template: ThemeTemplateV1; migratedFrom?: 0 }
  | { success: false; message: string; issues?: z.core.$ZodIssue[] };

export const parseThemeTemplate = (input: unknown): ThemeTemplateParseResult => {
  const inspection = inspectThemeTemplateInput(input);
  if (!inspection.ok) return { success: false, message: inspection.message };

  const record = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
  if (!record) return { success: false, message: 'Theme template must be a JSON object.' };
  if (record.kind !== THEME_TEMPLATE_KIND) return { success: false, message: `Theme template kind must be "${THEME_TEMPLATE_KIND}".` };

  if (record.version === 0) {
    const legacy = legacyThemeTemplateV0Schema.safeParse(input);
    if (!legacy.success) return { success: false, message: 'Legacy theme template is invalid.', issues: legacy.error.issues };
    const template: ThemeTemplateV1 = {
      kind: THEME_TEMPLATE_KIND,
      version: THEME_SCHEMA_VERSION,
      metadata: {
        name: legacy.data.name,
        description: legacy.data.description ?? 'Imported from a Nibleaf theme template v0.',
        ...(legacy.data.author ? { author: legacy.data.author } : {}),
      },
      config: {
        theme: {
          version: THEME_SCHEMA_VERSION,
          preset: legacy.data.preset ?? 'harbor',
          metadata: {
            name: legacy.data.name,
            description: legacy.data.description ?? 'Imported from a Nibleaf theme template v0.',
            ...(legacy.data.author ? { author: legacy.data.author } : {}),
          },
        },
        styling: {
          ...(legacy.data.primaryColor ? { primaryColor: legacy.data.primaryColor } : {}),
          ...(legacy.data.appearance ? { theme: legacy.data.appearance } : {}),
          ...(legacy.data.radius ? { radius: legacy.data.radius } : {}),
        },
      },
    };
    const checked = themeTemplateV1Schema.safeParse(template);
    return checked.success
      ? { success: true, template: checked.data, migratedFrom: 0 }
      : { success: false, message: 'Migrated theme template is invalid.', issues: checked.error.issues };
  }

  if (record.version !== THEME_SCHEMA_VERSION) {
    return {
      success: false,
      message: `Theme template version ${String(record.version)} is not supported. This Nibleaf build supports versions 0 and ${THEME_SCHEMA_VERSION}.`,
    };
  }
  const checked = themeTemplateV1Schema.safeParse(input);
  return checked.success
    ? { success: true, template: checked.data }
    : { success: false, message: 'Theme template failed validation.', issues: checked.error.issues };
};
