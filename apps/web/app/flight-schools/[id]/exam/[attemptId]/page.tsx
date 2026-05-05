import { auth } from '@/auth';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import {
  prisma,
  getAttemptWithQuestions,
  PASS_MARK_PERCENT,
  licenseDisplayName,
} from '@vam/db';
import { ExamRunner, type ExamQuestionPublic } from './exam-runner';

interface Props {
  params: Promise<{ id: string; attemptId: string }>;
}

/**
 * Theory-exam quiz-page (Welle 13E-13c).
 *
 * Server-component lädt attempt + questions, prüft ownership + career-mode,
 * und passt die data zur client-runner-component. Wichtige sicherheits-
 * policy: bei in-progress attempts strippen wir correctIndex + explanation
 * BEVOR wir die data zum client schicken — sonst könnte ein client-side
 * cheater einfach im DOM die richtigen antworten ablesen. Bei submitted
 * attempts (review-mode) sind die felder included weil der pilot dann
 * lernen soll.
 *
 * Routing:
 *   - /flight-schools/[id]/exam/[attemptId]
 *   - id = schoolId (für breadcrumb + post-submit-redirect)
 *   - attemptId = TheoryExamAttempt.id
 *
 * Wir validieren dass die schoolId aus URL mit der enrollment.schoolId
 * matcht — sonst landed der pilot auf inkonsistenter URL und
 * post-submit-revalidate würde die falsche page invalidaten. notFound()
 * statt redirect weil's ein client-bug-symptom ist, kein normaler flow.
 */
export default async function TheoryExamPage({ params }: Props) {
  const { id: schoolId, attemptId } = await params;

  const session = await auth();
  if (!session?.user) redirect('/');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { airline: { select: { careerEnabled: true } } },
  });
  if (!user) redirect('/');

  const hasCareer = !!(user.careerEnabled && user.airline?.careerEnabled);
  if (!hasCareer) redirect('/settings#profile');

  const attemptData = await getAttemptWithQuestions(attemptId);
  if (!attemptData) notFound();

  const { attempt, questions: rawQuestions } = attemptData;

  // Ownership-check — pilot darf nur seine eigenen attempts sehen.
  const enrollment = await prisma.flightSchoolEnrollment.findUnique({
    where: { id: attempt.enrollmentId },
    select: {
      id: true,
      userId: true,
      schoolId: true,
      licenseType: true,
      school: { select: { name: true } },
    },
  });
  if (!enrollment || enrollment.userId !== user.id) {
    notFound();
  }

  // URL-konsistenz-check: schoolId in URL muss mit enrollment.schoolId
  // matchen. Wenn nicht: redirect auf korrekte URL (besseres UX als 404
  // weil der attempt grundsätzlich legit ist, nur die URL falsch).
  if (enrollment.schoolId !== schoolId) {
    redirect(`/flight-schools/${enrollment.schoolId}/exam/${attemptId}`);
  }

  const isSubmitted = attempt.submittedAt !== null;

  // Strippen für in-progress: correctIndex + explanation auf null setzen.
  // Bei submitted: passthrough mit den echten werten.
  const publicQuestions: ExamQuestionPublic[] = rawQuestions.map((q) => ({
    id: q.id,
    questionText: q.questionText,
    options: q.options,
    correctIndex: isSubmitted ? q.correctIndex : null,
    explanation: isSubmitted ? q.explanation : null,
  }));

  const reviewScore =
    isSubmitted && attempt.scorePercent !== null && attempt.passed !== null
      ? { scorePercent: attempt.scorePercent, passed: attempt.passed }
      : null;

  return (
    <main className="px-6 py-8 sm:px-10 lg:px-12 max-w-4xl mx-auto">
      {/* Breadcrumb */}
      <div className="mb-4">
        <Link
          href={`/flight-schools/${schoolId}`}
          className="text-sm text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition"
        >
          ← {enrollment.school.name}
        </Link>
      </div>

      {/* Header */}
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Theorie-Prüfung: {licenseDisplayName(enrollment.licenseType)}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {isSubmitted
            ? `Eingereicht am ${attempt.submittedAt!.toLocaleString('de-DE')}`
            : `Begonnen am ${attempt.startedAt.toLocaleString('de-DE')} · Bestehensgrenze ${PASS_MARK_PERCENT}%`}
        </p>
      </header>

      <ExamRunner
        attemptId={attempt.id}
        schoolId={schoolId}
        questions={publicQuestions}
        initialAnswers={attempt.answers}
        isSubmitted={isSubmitted}
        reviewScore={reviewScore}
        passMarkPercent={PASS_MARK_PERCENT}
      />
    </main>
  );
}
