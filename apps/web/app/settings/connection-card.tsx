'use client';

import Link from 'next/link';

type Props = {
  provider: 'discord' | 'vatsim' | 'ivao';
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
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '1rem',
        backgroundColor: 'rgba(31, 41, 55, 0.5)',
        border: '1px solid rgb(31, 41, 55)',
        borderRadius: '0.5rem',
      }}
    >
      <div className="flex items-center gap-4">
        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center ${colorClass}`}
          style={{ flexShrink: 0 }}
        >
          <span className="text-lg">{icon}</span>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <p className="font-semibold">{name}</p>
            {connected && verified && (
              <span
                style={{
                  fontSize: '0.7rem',
                  padding: '0.1rem 0.5rem',
                  backgroundColor: 'rgba(34, 197, 94, 0.15)',
                  color: 'rgb(74, 222, 128)',
                  borderRadius: '0.25rem',
                  border: '1px solid rgba(34, 197, 94, 0.3)',
                }}
              >
                ✓ verifiziert
              </span>
            )}
            {connected && !verified && (
              <span
                style={{
                  fontSize: '0.7rem',
                  padding: '0.1rem 0.5rem',
                  backgroundColor: 'rgba(245, 158, 11, 0.15)',
                  color: 'rgb(251, 191, 36)',
                  borderRadius: '0.25rem',
                  border: '1px solid rgba(245, 158, 11, 0.3)',
                }}
              >
                unverifiziert
              </span>
            )}
          </div>
          {connected ? (
            <p className="text-xs text-gray-400 mt-1">
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
                style={{
                  padding: '0.5rem 1rem',
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  color: 'rgb(248, 113, 113)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: '0.375rem',
                  fontSize: '0.875rem',
                  cursor: 'pointer',
                  transition: 'background-color 150ms',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.2)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
                }}
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
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: 'rgba(99, 102, 241, 0.1)',
              color: 'rgb(165, 180, 252)',
              border: '1px solid rgba(99, 102, 241, 0.3)',
              borderRadius: '0.375rem',
              fontSize: '0.875rem',
              textDecoration: 'none',
              transition: 'background-color 150ms',
            }}
          >
            Verbinden
          </Link>
        )}
      </div>
    </div>
  );
}