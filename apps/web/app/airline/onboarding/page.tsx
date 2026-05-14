import { redirect } from 'next/navigation';
import Link from 'next/link';

import { auth } from '@/auth';
import { prisma } from '@vam/db';

import { StepProfile } from './step-profile';
import { StepBase } from './step-base';
import { StepPreferences } from './step-preferences';
import { StepDone } from './step-done';

/**
 * Welle F / F4 — Member-Onboarding-Wizard.
 *
 * Route: /airline/onboarding[?step=1|2|3|4]
 *
 * Multi-step setup-flow für neue airline-member nach invite-accept.
 * Server-rendered shell mit step-routing via query-param; jeder step
 * ist ein client-component mit eigenem form-state + server-action.
 *
 * # Step-Plan
 *
 *   1. Profile     — name + bio
 *   2. Base        — home base aus airline.hubs
 *   3. Preferences — economy + career opt-ins
 *   4. Done        — recap + next-steps + finish-button
 *
 * # Auth-Gates (cascade)
 *
 *   1. Session → redirect /
 *   2. User mit airline → wenn keine airline, redirect /dashboard
 *      (kein passender wizard ohne airline-context)
 *   3. Schon completed → redirect /dashboard (außer ?step explizit
 *      gesetzt — dann lassen wir den user nochmal durchlaufen, z.B.
 *      für "wizard wiederholen"-link aus admin-debugging)
 *
 * # Step-routing
 *
 * URL ?step=1|2|3|4 entscheidet welcher step gerendert wird. Default
 * 1 wenn fehlt/invalid. Each step's "Weiter"-button navigates per
 * router.push zu ?step=N+1, "Zurück" zu N-1, "Skip" → /dashboard via
 * completeOnboarding action.
 *
 * # Why query-param statt path-segments?
 *
 * Steps haben pro-step server-state (initial values aus user-row).
 * Path-segments würden 4 separate page.tsx erfordern, die alle die
 * gleichen user-load operations machen. Query-param hält alles in
 * einer page mit shared data-load.
 */

type Step = 1 | 2 | 3 | 4;

function parseStep(raw: string | undefined): Step {
  const n = Number(raw);
  if (n === 2 || n === 3 || n === 4) return n;
  return 1;
}

const STEP_LABELS: Record<Step, string> = {
  1: 'Profil',
  2: 'Home-Base',
  3: 'Features',
  4: 'Fertig',
};

interface PageProps {
  searchParams: Promise<{ step?: string; force?: string }>;
}

export default async function OnboardingPage({ searchParams }: PageProps) {
  // Gate 1: session.
  const session = await auth();
  if (!session?.user?.id) redirect('/');

  const params = await searchParams;
  const step = parseStep(params.step);
  // Optional ?force=1 erlaubt re-run nach completion (admin-debug + user-
  // request "ich will den wizard nochmal durchgehen"). Ohne force →
  // completed-user wird redirected.
  const force = params.force === '1';

  // Gate 2: load user with everything the wizard might need. Single
  // round-trip statt 4x.
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      bio: true,
      baseIcao: true,
      economyEnabled: true,
      careerEnabled: true,
      onboardingCompletedAt: true,
      airline: {
        select: {
          name: true,
          icao: true,
          economyEnabled: true,
          careerEnabled: true,
          hubs: {
            select: {
              isPrimary: true,
              airport: { select: { icao: true, name: true } },
            },
            orderBy: [{ isPrimary: 'desc' as const }, { airportIcao: 'asc' as const }],
          },
        },
      },
    },
  });

  if (!user) redirect('/');
  if (!user.airline) redirect('/dashboard');

  // Gate 3: skip if already done (unless force=1).
  if (user.onboardingCompletedAt && !force) {
    redirect('/dashboard');
  }

  // Normalize hubs to flat shape for child components.
  const hubsFlat = user.airline.hubs.map((h) => ({
    icao: h.airport.icao,
    name: h.airport.name,
    isPrimary: h.isPrimary,
  }));

  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-2xl">
        {/* Header */}
        <header className="mb-6 border-b border-border pb-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Onboarding · {user.airline.icao}
          </p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">
            Willkommen bei {user.airline.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Vier kurze Schritte, dann bist du startklar. Du kannst den
            Wizard jederzeit überspringen — alle Einstellungen lassen sich
            später unter /settings anpassen.
          </p>
        </header>

        {/* Progress bar (4-segment dotted progress). Bewusst auf dem
            server gerendert statt im step-component damit es zwischen
            steps stabil bleibt und nicht flackert beim navigieren. */}
        <nav className="mb-6 flex items-center gap-2" aria-label="Onboarding-Fortschritt">
          {([1, 2, 3, 4] as const).map((n) => {
            const isActive = n === step;
            const isComplete = n < step;
            return (
              <div key={n} className="flex flex-1 items-center gap-2">
                <Link
                  href={`/airline/onboarding?step=${n}${force ? '&force=1' : ''}`}
                  className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-semibold transition ${
                    isActive
                      ? 'border-indigo-600 bg-indigo-600 text-white'
                      : isComplete
                        ? 'border-emerald-500 bg-emerald-500 text-white'
                        : 'border-border bg-background text-muted-foreground hover:border-muted-foreground'
                  }`}
                  aria-current={isActive ? 'step' : undefined}
                  aria-label={`Schritt ${n}: ${STEP_LABELS[n]}`}
                >
                  {isComplete ? '✓' : n}
                </Link>
                <span
                  className={`hidden text-xs sm:inline ${
                    isActive ? 'font-semibold' : 'text-muted-foreground'
                  }`}
                >
                  {STEP_LABELS[n]}
                </span>
                {n < 4 && (
                  <div className="flex-1 border-t border-dashed border-border" aria-hidden />
                )}
              </div>
            );
          })}
        </nav>

        {/* Step content. Per step ein client-component damit Form-state
            interactivity bekommt. Server-side data wird als props
            übergeben (initial values + airline-state). */}
        {step === 1 && (
          <StepProfile initialName={user.name} initialBio={user.bio} />
        )}
        {step === 2 && (
          <StepBase initialBase={user.baseIcao} hubs={hubsFlat} />
        )}
        {step === 3 && (
          <StepPreferences
            initialEconomy={user.economyEnabled}
            initialCareer={user.careerEnabled}
            airlineEconomyEnabled={user.airline.economyEnabled}
            airlineCareerEnabled={user.airline.careerEnabled}
          />
        )}
        {step === 4 && (
          <StepDone
            airlineName={user.airline.name}
            airlineIcao={user.airline.icao}
            pickedBase={user.baseIcao}
            enabledFeatures={{
              economy: user.economyEnabled,
              career: user.careerEnabled,
            }}
          />
        )}
      </div>
    </main>
  );
}
