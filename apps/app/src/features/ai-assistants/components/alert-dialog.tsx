import { Button } from '@nibleaf/design-system/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nibleaf/design-system/components/ui/dialog';
import type { ComponentProps } from 'react';

export const AlertDialog = (props: ComponentProps<typeof Dialog>) => <Dialog {...props} modal disablePointerDismissal />;
export const AlertDialogDescription = DialogDescription;
export const AlertDialogFooter = DialogFooter;
export const AlertDialogHeader = DialogHeader;
export const AlertDialogTitle = DialogTitle;

export const AlertDialogContent = (props: ComponentProps<typeof DialogContent>) => (
  <DialogContent role="alertdialog" showCloseButton={false} {...props} />
);

export const AlertDialogCancel = ({ children, ...props }: ComponentProps<typeof Button>) => (
  <DialogClose render={<Button autoFocus type="button" variant="outline" {...props} />}>{children}</DialogClose>
);

export const AlertDialogAction = (props: ComponentProps<typeof Button>) => <Button type="button" variant="destructive" {...props} />;
