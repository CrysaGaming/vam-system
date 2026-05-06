'use client';

import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Props = {
  provider: 'discord' | 'vatsim' | 'ivao' | 'twitch';
  name: string;
  icon: string;
  colorClass: string;
  connected: boolean;
  accountId: string | null;
  verified: boolean;
  verifiedAt?: Date | null;
  note?: string;
  canDisconnect: boolean;
};

export function ConnectionCard({
  provider,
  name,
  icon,
  colorClass,
  connected,
  accountId,
  verified,
  verifiedAt,
  note,
  canDisconnect,
}: Props) {
  const verifiedDate = verifiedAt
    ? new Date(verifiedAt).toLocaleDateString('de-DE', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null;

  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-muted/50 p-4">
      <div className="flex items-center gap-4">
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
            colorClass,
          )}
        >
          <span className="text-lg">{icon}</span>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <p className="font-semibold">{name}</p>
            {connected && verified && (
              <Badge
                variant="outline"
                className="border-green-500/30 bg-green-500/15 text-green-700 dark:text-green-400"
              >
                ✓ verifiziert
              </Badge>
            )}
            {connected && !verified && (
              <Badge
                variant="outline"
                className="border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-400"
              >
                unverifiziert
              </Badge>
            )}
          </div>
          {connected ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {accountId && `ID: ${accountId}`}
              {verifiedDate && ` · verbunden am ${verifiedDate}`}
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              {note ?? 'Nicht verbunden'}
            </p>
          )}
        </div>
      </div>

      <div>
        {connected ? (
          canDisconnect ? (
            <form action={`/api/auth/${provider}/disconnect`} method="POST">
              <Button
                type="submit"
                variant="outline"
                size="sm"
                className="border-red-500/30 bg-red-500/10 text-red-700 hover:bg-red-500/20 hover:text-red-700 dark:text-red-400 dark:hover:text-red-400"
              >
                Trennen
              </Button>
            </form>
          ) : (
            <span className="text-xs text-muted-foreground">primär</span>
          )
        ) : (
          <Button
            asChild
            variant="outline"
            size="sm"
            className="border-indigo-500/30 bg-indigo-500/10 text-indigo-700 hover:bg-indigo-500/20 hover:text-indigo-700 dark:text-indigo-300 dark:hover:text-indigo-300"
          >
            <Link href={`/api/auth/${provider}/start`}>Verbinden</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
