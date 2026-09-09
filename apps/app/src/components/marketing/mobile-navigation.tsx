import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from '@nibleaf/design-system/components/ui/dialog';
import { Menu, X } from 'lucide-react';
import { type ReactNode, useState } from 'react';

export function MobileNavigation({
  language = 'en',
  links,
  className = 'xl:hidden',
  children,
}: {
  language?: 'en' | 'ar';
  links: { href: string; label: string }[];
  className?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const arabic = language === 'ar';
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        aria-label={arabic ? 'فتح القائمة' : 'Open menu'}
        className={`grid size-10 shrink-0 place-items-center rounded-md border border-border hover:bg-muted ${className}`}
      >
        <Menu aria-hidden="true" className="size-5" />
      </DialogTrigger>
      <DialogContent dir={arabic ? 'rtl' : 'ltr'} className="max-h-[85dvh] overflow-y-auto" showCloseButton={false}>
        <div className="flex items-center justify-between gap-4">
          <DialogTitle>{arabic ? 'القائمة' : 'Menu'}</DialogTitle>
          <DialogClose aria-label={arabic ? 'إغلاق القائمة' : 'Close menu'} className="grid size-10 place-items-center rounded-md hover:bg-muted">
            <X aria-hidden="true" className="size-5" />
          </DialogClose>
        </div>
        <nav aria-label={arabic ? 'التنقل الرئيسي' : 'Main navigation'} className="grid gap-1">
          {links.map((link) => (
            <a key={link.href} href={link.href} onClick={() => setOpen(false)} className="rounded-md px-3 py-3 text-start hover:bg-muted">
              {link.label}
            </a>
          ))}
        </nav>
        {children}
      </DialogContent>
    </Dialog>
  );
}
