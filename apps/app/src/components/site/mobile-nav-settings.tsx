import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import type { MobileNavChoice } from '@/components/site/mobile-nav';

/**
 * The phone drawer's language and version choices. Loaded only when the drawer
 * opens, so the Select primitive stays out of every public docs page's first load.
 */
export default function MobileNavSettings({ settings, onChosen }: { settings: MobileNavChoice[]; onChosen: () => void }) {
  return (
    <>
      {settings.map((choice) => (
        <div key={choice.id} className="grid gap-1.5" data-mobile-nav-setting={choice.id}>
          <span aria-hidden className="px-1 font-semibold text-foreground text-xs">
            {choice.label}
          </span>
          <Select
            items={choice.options.map((option) => ({ value: option.value, label: option.label }))}
            value={choice.value}
            onValueChange={(value) => {
              if (!value || value === choice.value) return;
              choice.onChange(value);
              onChosen();
            }}
          >
            <SelectTrigger aria-label={choice.label} className="min-h-11 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {choice.options.map((option) => (
                <SelectItem key={option.value} value={option.value} className="min-h-11">
                  <span lang={option.lang} dir={option.dir}>
                    {option.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
    </>
  );
}
