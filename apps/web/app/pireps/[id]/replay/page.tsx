import { auth } from '@/auth';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma, hasReplayDataForPirep } from '@vam/db';
import { isApproverRole } from '@/lib/roles';
import { ReplayMap } from './replay-map';

/**
 * Track 1 #5 (Replay-Mode, 9.2.7) — Replay-page.
 *
 * Track 5 #3 (PIREP-Annotations): Annotations werden hier server-side
 * geladen und als prop an ReplayMap übergeben. Die map rendert sie als
 * farbige marker auf dem time-slider + als popup-bubble wenn der user
 * auf frame eines annotated-moments springt.
 *
 * Server-component lädt PIREP-context + admin-checks + existence-prüfung
 * für replay-data. Das eigentliche fetching der trail-positions passiert
 * im client-component (ReplayMap) via /api/pireps/[id]/replay damit der
 * initial-page-render nicht durch eine ggf. mehrere-tausend-positions-
 * große response blockiert wird.
 */
export default async function PirepReplayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/');

  const { id } = await params;

  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, airlineId: true, role: { select: { name: true } } },
  });
  if (!currentUser) redirect('/');

  const pirep = await prisma.pirep.findUnique({
    where: { id },
    include: {
      route: true,
      departure: { select: { icao: true, name: true } },
      arrival: { select: { icao: true, name: true } },
      user: { select: { id: true, name: true } },
    },
  });
  if (!pirep) notFound();

  // Visibility (matched pirep detail-page)
  const isOwn = pirep.userId === currentUser.id;
  const isApprover = isApproverRole(currentUser.role?.name);
  const sameAirline = pirep.airlineId === currentUser.airlineId;
  if (!isOwn && !(isApprover && sameAirline)) {
    redirect('/pireps');
  }

  const hasReplay = await hasReplayDataForPirep(id);
  if (!hasReplay) {
    redirect(`/pireps/${id}`);
  }

  // Track 5 #3: annotations fetch parallel mit rest.
  // frameIndex gibt die position auf dem time-slider,
  // author.name wird im popup angezeigt.
  const annotations = await prisma.pirepAnnotation.findMany({
    where: { pirepId: id },
    select: {
      id: true,
      frameIndex: true,
      body: true,
      author: { select: { name: true } },
    },
    orderBy: { frameIndex: 'asc' },
  });

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!mapboxToken) {
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white p-8">
        <p>Mapbox nicht konfiguriert.</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white flex flex-col">
      <header className="px-6 py-4 border-b border-gray-200 dark:border-gray-800 flex justify-between items-center flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-lg font-bold font-mono">
            {pirep.route?.flightNumber ?? 'Flight'}
          </h1>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            <span className="font-mono">{pirep.departure.icao}</span>
            <span className="mx-2">→</span>
            <span className="font-mono">{pirep.arrival.icao}</span>
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-500">
            ·{' '}
            {pirep.user.name && pirep.userId !== currentUser.id
              ? pirep.user.name
              : 'Replay'}
          </span>
          {annotations.length > 0 && (
            <span className="text-xs bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 px-2 py-0.5 rounded-full">
              📝 {annotations.length}{' '}
              {annotations.length === 1 ? 'Annotation' : 'Annotationen'}
            </span>
          )}
        </div>
        <Link
          href={`/pireps/${pirep.id}`}
          className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 rounded text-sm transition"
        >
          ← Zurück zum PIREP
        </Link>
      </header>
      <div className="flex-1 relative">
        <ReplayMap
          pirepId={pirep.id}
          mapboxToken={mapboxToken}
          annotations={annotations}
        />
      </div>
    </main>
  );
}
