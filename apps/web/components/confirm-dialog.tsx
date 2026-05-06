'use client';

import * as React from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * ConfirmDialog — drop-in replacement für `window.confirm()`.
 *
 * Wraps shadcn AlertDialog mit dem standard-pattern: titel + beschreibung
 * + cancel/confirm-buttons. Optional `destructive` für rote bestätigung
 * (löschen, trennen). Für andere kritische actions (resets, zurücksetzen)
 * default-button.
 *
 * Usage-pattern in der card:
 *   const [confirmOpen, setConfirmOpen] = useState(false);
 *   ...
 *   <Button onClick={() => setConfirmOpen(true)}>Löschen</Button>
 *   <ConfirmDialog
 *     open={confirmOpen}
 *     onOpenChange={setConfirmOpen}
 *     title="Wirklich löschen?"
 *     description="Diese aktion ist nicht umkehrbar."
 *     destructive
 *     onConfirm={() => { doDelete(); }}
 *   />
 *
 * AlertDialogAction schließt den dialog automatisch nach klick — `onConfirm`
 * wird daher synchron ausgeführt, side-effects (transition starten, state
 * updaten) laufen normal weiter.
 */
type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
};

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Bestätigen',
  cancelLabel = 'Abbrechen',
  destructive = false,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={
              destructive
                ? cn(buttonVariants({ variant: 'destructive' }))
                : undefined
            }
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
