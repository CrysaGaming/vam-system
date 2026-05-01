import { auth } from '@/auth';
import { prisma } from '@vam/db';
import Link from 'next/link';
import { AcceptButton } from './accept-button';

interface PageProps {
  params: Promise<{ token: string }>;
}

/**
 * Public accept-flow für Invite-Tokens. Server-rendered:
 *   - Token lookup ohne auth-requirement (404 wenn unbekannt)
 *   - Status-rendering: pending/used/expired/revoked
 *   - Wenn pending + nicht eingeloggt → Login-CTA mit callbackUrl
 *   - Wenn pending + eingeloggt → AcceptButton (client component)
 *
 * Auth-Decision: Wir schicken den User durch den normalen
 * Discord-OAuth-Flow. Nach Login landet er wieder hier (callbackUrl
 * preserved) und sieht den AcceptButton. Erst der Click triggert die
 * acceptInvite-action mit token-validation + airline-assignment.
 */
export default async function InvitePage({ params }: PageProps) {
  const { token } = await params;

  const invite = await prisma.invite.findUnique({
    where: { token },
    include: {
      airline: { select: { name: true, icao: true } },
      role: { select: { name: true, description: true } },
      createdBy: { select: { name: true } },
    },
  });

  if (!invite) {
    return (
      <Shell>
        <h1 className="text-xl font-bold mb-2">❌ Einladung nicht gefunden</h1>
        <p className="text-gray-600 dark:text-gray-300">
          Der Link ist ungültig oder wurde gelöscht. Wende dich an den
          Admin der Airline für einen neuen Link.
        </p>
        <Link href="/" className="inline-block mt-4 text-indigo-600 dark:text-indigo-400 hover:underline">
          ← Zur Startseite
        </Link>
      </Shell>
    );
  }

  const now = new Date();
  const isExpired = invite.expiresAt < now;
  const isUsed = invite.usedAt !== null;
  const isRevoked =
    isExpired && invite.expiresAt.getTime() < invite.createdAt.getTime() + 1000;

  if (isUsed) {
    return (
      <Shell>
        <h1 className="text-xl font-bold mb-2">✅ Einladung bereits eingelöst</h1>
        <p className="text-gray-600 dark:text-gray-300">
          Diese Einladung wurde am{' '}
          {invite.usedAt!.toLocaleDateString('de-DE')} eingelöst. Wenn
          das nicht du warst, wende dich an den Admin.
        </p>
        <Link href="/dashboard" className="inline-block mt-4 text-indigo-600 dark:text-indigo-400 hover:underline">
          → Zum Dashboard
        </Link>
      </Shell>
    );
  }

  if (isRevoked) {
    return (
      <Shell>
        <h1 className="text-xl font-bold mb-2">🚫 Einladung widerrufen</h1>
        <p className="text-gray-600 dark:text-gray-300">
          Diese Einladung wurde vom Admin zurückgezogen. Bitte fordere
          einen neuen Link an.
        </p>
        <Link href="/" className="inline-block mt-4 text-indigo-600 dark:text-indigo-400 hover:underline">
          ← Zur Startseite
        </Link>
      </Shell>
    );
  }

  if (isExpired) {
    return (
      <Shell>
        <h1 className="text-xl font-bold mb-2">⏰ Einladung abgelaufen</h1>
        <p className="text-gray-600 dark:text-gray-300">
          Diese Einladung ist am{' '}
          {invite.expiresAt.toLocaleDateString('de-DE')} abgelaufen.
          Bitte fordere einen neuen Link an.
        </p>
        <Link href="/" className="inline-block mt-4 text-indigo-600 dark:text-indigo-400 hover:underline">
          ← Zur Startseite
        </Link>
      </Shell>
    );
  }

  // Valid + pending. Check session.
  const session = await auth();

  return (
    <Shell>
      <h1 className="text-xl font-bold mb-1">✈️ Einladung zu {invite.airline.name}</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-0">
        ICAO {invite.airline.icao} · Eingeladen von{' '}
        {invite.createdBy.name ?? 'einem Admin'}
      </p>

      {invite.role && (
        <div className="my-4 p-3 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800 rounded text-sm">
          <strong>Rolle:</strong> {invite.role.name}
          {invite.role.description && (
            <div className="text-gray-600 dark:text-gray-300 mt-1">
              {invite.role.description}
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-gray-500 dark:text-gray-400">
        Gültig bis {invite.expiresAt.toLocaleString('de-DE')}
      </p>

      {!session?.user ? (
        <div className="mt-6">
          <p className="text-gray-700 dark:text-gray-200 mb-3">Bitte logge dich zuerst mit Discord ein, um die Einladung anzunehmen.</p>
          <Link
            href={`/api/auth/signin?callbackUrl=${encodeURIComponent(
              `/invite/${token}`,
            )}`}
            className="inline-block px-5 py-2.5 bg-[#5865F2] hover:bg-[#4752c4] text-white rounded font-medium transition no-underline"
          >
            Mit Discord einloggen
          </Link>
        </div>
      ) : (
        <div className="mt-6">
          <p className="mb-3 text-gray-700 dark:text-gray-200">
            Eingeloggt als <strong>{session.user.name ?? session.user.email}</strong>.
          </p>
          <AcceptButton token={token} airlineName={invite.airline.name} />
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-gray-50 dark:bg-gray-950">
      <div className="max-w-md w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-8 rounded-lg shadow-lg dark:shadow-black/40 text-gray-900 dark:text-white">
        {children}
      </div>
    </main>
  );
}
