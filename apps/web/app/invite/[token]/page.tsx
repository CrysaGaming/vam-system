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
        <h1>❌ Einladung nicht gefunden</h1>
        <p>
          Der Link ist ungültig oder wurde gelöscht. Wende dich an den
          Admin der Airline für einen neuen Link.
        </p>
        <Link href="/" style={linkStyle}>
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
        <h1>✅ Einladung bereits eingelöst</h1>
        <p>
          Diese Einladung wurde am{' '}
          {invite.usedAt!.toLocaleDateString('de-DE')} eingelöst. Wenn
          das nicht du warst, wende dich an den Admin.
        </p>
        <Link href="/dashboard" style={linkStyle}>
          → Zum Dashboard
        </Link>
      </Shell>
    );
  }

  if (isRevoked) {
    return (
      <Shell>
        <h1>🚫 Einladung widerrufen</h1>
        <p>
          Diese Einladung wurde vom Admin zurückgezogen. Bitte fordere
          einen neuen Link an.
        </p>
        <Link href="/" style={linkStyle}>
          ← Zur Startseite
        </Link>
      </Shell>
    );
  }

  if (isExpired) {
    return (
      <Shell>
        <h1>⏰ Einladung abgelaufen</h1>
        <p>
          Diese Einladung ist am{' '}
          {invite.expiresAt.toLocaleDateString('de-DE')} abgelaufen.
          Bitte fordere einen neuen Link an.
        </p>
        <Link href="/" style={linkStyle}>
          ← Zur Startseite
        </Link>
      </Shell>
    );
  }

  // Valid + pending. Check session.
  const session = await auth();

  return (
    <Shell>
      <h1 style={{ marginBottom: 4 }}>✈️ Einladung zu {invite.airline.name}</h1>
      <p style={{ color: '#666', marginTop: 0 }}>
        ICAO {invite.airline.icao} · Eingeladen von{' '}
        {invite.createdBy.name ?? 'einem Admin'}
      </p>

      {invite.role && (
        <div
          style={{
            margin: '16px 0',
            padding: 12,
            background: '#eef',
            borderRadius: 6,
            fontSize: 14,
          }}
        >
          <strong>Rolle:</strong> {invite.role.name}
          {invite.role.description && (
            <div style={{ color: '#446', marginTop: 4 }}>
              {invite.role.description}
            </div>
          )}
        </div>
      )}

      <p style={{ fontSize: 13, color: '#888' }}>
        Gültig bis {invite.expiresAt.toLocaleString('de-DE')}
      </p>

      {!session?.user ? (
        <div style={{ marginTop: 24 }}>
          <p>Bitte logge dich zuerst mit Discord ein, um die Einladung anzunehmen.</p>
          <Link
            href={`/api/auth/signin?callbackUrl=${encodeURIComponent(
              `/invite/${token}`,
            )}`}
            style={{
              display: 'inline-block',
              padding: '10px 20px',
              background: '#5865F2',
              color: '#fff',
              borderRadius: 6,
              textDecoration: 'none',
              fontWeight: 500,
            }}
          >
            Mit Discord einloggen
          </Link>
        </div>
      ) : (
        <div style={{ marginTop: 24 }}>
          <p style={{ marginBottom: 12 }}>
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
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        background: '#fafafa',
      }}
    >
      <div
        style={{
          maxWidth: 480,
          width: '100%',
          background: '#fff',
          padding: 32,
          borderRadius: 8,
          boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        }}
      >
        {children}
      </div>
    </main>
  );
}

const linkStyle: React.CSSProperties = {
  display: 'inline-block',
  marginTop: 16,
  color: '#06c',
  textDecoration: 'none',
};
