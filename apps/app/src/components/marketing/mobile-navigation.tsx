import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from '@nibleaf/design-system/components/ui/dialog';
import { Menu, X } from 'lucide-react';
import { type ReactNode, useState } from 'react';

export function MobileNavigation({
  language = 'en',
  links,
  className = 'xl:hidden',
  children,
  labels,
  navLabel,
}: {
  language?: 'en' | 'ar';
  links: { href: string; label: string }[];
  className?: string;
  children?: ReactNode;
  labels?: { open: string; close: string; title: string };
  navLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const arabic = language === 'ar';
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        aria-label={labels?.open ?? (arabic ? 'فتح القائمة' : 'Open menu')}
        className={`grid size-11 shrink-0 place-items-center rounded-md border border-border hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 ${className}`}
      >
        <Menu aria-hidden="true" className="size-5" />
      </DialogTrigger>
      <DialogContent lang={language} dir={arabic ? 'rtl' : 'ltr'} className="max-h-[85dvh] overflow-y-auto" showCloseButton={false}>
        <div className="flex items-center justify-between gap-4">
          <DialogTitle>{labels?.title ?? (arabic ? 'القائمة' : 'Menu')}</DialogTitle>
          <DialogClose
            aria-label={labels?.close ?? (arabic ? 'إغلاق القائمة' : 'Close menu')}
            className="grid size-11 place-items-center rounded-md hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            <X aria-hidden="true" className="size-5" />
          </DialogClose>
        </div>
        <nav aria-label={navLabel ?? (arabic ? 'التنقل الرئيسي' : 'Main navigation')} className="grid gap-1">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="min-h-11 rounded-md px-3 py-3 text-start hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            >
              {link.label}
            </a>
          ))}
        </nav>
        {children}
      </DialogContent>
    </Dialog>
  );
}
