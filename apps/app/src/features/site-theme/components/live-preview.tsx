import { Button } from '@nibleaf/design-system/components/ui/button';
import { SegmentedControl, SegmentedControlItem } from '@nibleaf/design-system/components/ui/segmented-control';
import { useT } from '@nibleaf/i18n/react';
import type { ProjectConfig } from '@nibleaf/validators';
import { useState } from 'react';
import { themePreviewText } from '../theme-preview-messages';
import { ThemePreview } from './theme-preview';

type PreviewMode = 'light' | 'dark';

/**
 * The live preview of a site's look, with its two view controls: light or
 * dark, and English or Arabic content (right to left). Both are view state,
 * never saved. It opens in the mode the site shows by default, or, for a site
 * that follows the reader's system, in the mode the dashboard itself shows;
 * and with Arabic content while the dashboard is in Arabic.
 */
export function LivePreview({
  config,
  dashboardMode,
  dashboardArabic,
}: {
  config: ProjectConfig;
  dashboardMode: PreviewMode;
  dashboardArabic: boolean;
}) {
  const t = useT();
  const appearance = config.styling?.theme;
  const [mode, setMode] = useState<PreviewMode>(() => (appearance === 'dark' || appearance === 'light' ? appearance : dashboardMode));
  const [arabic, setArabic] = useState(dashboardArabic);
  return (
    <div className="flex min-w-0 flex-col gap-3" data-live-preview="">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl aria-label={t('settings.appearance.preview.mode')} className="w-auto" role="group">
          {(['light', 'dark'] as const).map((value) => (
            <SegmentedControlItem active={mode === value} key={value} onClick={() => setMode(value)}>
              {t(value === 'light' ? 'settings.styling.theme.light' : 'settings.styling.theme.dark')}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
        {/* Named in the language it switches to, so the person who reads it can find it. */}
        <Button
          dir={arabic ? 'ltr' : 'rtl'}
          lang={arabic ? 'en' : 'ar'}
          onClick={() => setArabic((value) => !value)}
          size="sm"
          type="button"
          variant="outline"
        >
          {arabic ? themePreviewText('settings.theme.preview.switchEnglish', 'en') : themePreviewText('settings.theme.preview.switchArabic', 'ar')}
        </Button>
      </div>
      <ThemePreview arabic={arabic} config={config} mode={mode} />
    </div>
  );
}
