'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { acceptInvite } from '../../airline/invites-actions';

interface Props {
  token: string;
  airlineName: string;
}

/**
 * Client-component für den finalen Accept-click. Trennt die
 * server-rendered page von der user-interaction um React Server
 * Component-Constraints zu respektieren (no hooks, no event-handlers
 * in server components).
 */
export function AcceptButton({ token, airlineName }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function handleAccept() {
    setError(null);
    startTransition(async () => {
      const result = await acceptInvite(token);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSuccess(true);
      // Brief delay so user sees the confirmation, then redirect.
      // Welle F / F4: Statt direkt zum dashboard → erst durch das
      // Onboarding-Wizard. Page-side gate redirected automatisch
      // zu /dashboard wenn onboardingCompletedAt schon gesetzt
      // (sehr unwahrscheinlich post-accept, aber idempotent gegen
      // edge-cases wie multi-airline-wechsel).
      setTimeout(() => router.push('/airline/onboarding'), 1500);
    });
  }

  if (success) {
    return (
      <div
        style={{
          padding: 16,
          background: '#cfc',
          color: '#060',
          borderRadius: 6,
          textAlign: 'center',
        }}
      >
        ✅ Willkommen bei {airlineName}! Weiterleitung zum Dashboard…
      </div>
    );
  }

  return (
    <>
      {error && (
        <div
          style={{
            marginBottom: 12,
            padding: 8,
            background: '#fee',
            color: '#900',
            borderRadius: 4,
          }}
        >
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={handleAccept}
        disabled={pending}
        style={{
          padding: '12px 24px',
          background: '#06c',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          fontSize: 16,
          fontWeight: 500,
          cursor: pending ? 'wait' : 'pointer',
          opacity: pending ? 0.7 : 1,
        }}
      >
        {pending ? 'Wird angenommen…' : `✓ Einladung annehmen`}
      </button>
    </>
  );
}
