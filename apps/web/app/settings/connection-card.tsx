'use client';

import Link from 'next/link';

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
    <div className="flex justify-between items-center p-4 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-800 rounded-lg">
      <div className="flex items-center gap-4">
        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${colorClass}`}
        >
          <span className="text-lg">{icon}</span>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <p className="font-semibold">{name}</p>
            {connected && verified && (
              <span className="text-xs px-2 py-0.5 bg-green-500/15 text-green-700 dark:text-green-400 border border-green-500/30 rounded">
                ✓ verifiziert
              </span>
            )}
            {connected && !verified && (
              <span className="text-xs px-2 py-0.5 bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30 rounded">
                unverifiziert
              </span>
            )}
          </div>
          {connected ? (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {accountId && `ID: ${accountId}`}
              {verifiedDate && ` · verbunden am ${verifiedDate}`}
            </p>
          ) : (
            <p className="text-xs text-gray-500 mt-1">
              {note ?? 'Nicht verbunden'}
            </p>
          )}
        </div>
      </div>

      <div>
        {connected ? (
          canDisconnect ? (
            <form action={`/api/auth/${provider}/disconnect`} method="POST">
              <button
                type="submit"
                className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-700 dark:text-red-400 border border-red-500/30 rounded-md text-sm cursor-pointer transition-colors"
              >
                Trennen
              </button>
            </form>
          ) : (
            <span className="text-xs text-gray-500">primär</span>
          )
        ) : (
          <Link
            href={`/api/auth/${provider}/start`}
            className="px-4 py-2 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30 rounded-md text-sm transition-colors no-underline inline-block"
          >
            Verbinden
          </Link>
        )}
      </div>
    </div>
  );
}
